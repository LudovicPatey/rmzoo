<?php
// Shared code of the endorsement server (see index.php and docs/ENDORSEMENTS.md).
// Plain PHP 7.4+, no dependencies: it runs on standard shared hosting.

declare(strict_types=1);

function cfg(): array {
  static $c = null;
  if ($c !== null) return $c;
  $file = getenv('RMZOO_CONFIG') ?: __DIR__ . '/config.php';
  if (!is_file($file)) fail(503, 'The endorsement server is not configured (copy api/config.example.php to api/config.php).');
  $c = require $file;
  $c += [
    'orcid_base' => 'https://orcid.org',
    'data_dir' => dirname(__DIR__, 2) . '/rmzoo-data',
    'zoo_json' => dirname(__DIR__) . '/data/zoo.json',
    'review_json' => dirname(__DIR__) . '/data/review.json',
    'dev_login' => false,
    'feedback_per_day' => 30,
  ];
  return $c;
}

// ---- responses ------------------------------------------------------------------
function json_out($data, int $code = 200): void {
  http_response_code($code);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
function fail(int $code, string $msg): void { json_out(['error' => $msg], $code); }
function redirect(string $url): void { header('Location: ' . $url, true, 302); exit; }

// ---- session --------------------------------------------------------------------
function https(): bool {
  return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}
function start_session(): void {
  if (session_status() === PHP_SESSION_ACTIVE) return;
  $dir = cfg()['data_dir'] . '/sessions';
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  if (is_dir($dir)) session_save_path($dir);
  session_name('rmzoo');
  session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => https(), 'httponly' => true, 'samesite' => 'Lax']);
  ini_set('session.gc_maxlifetime', (string) (60 * 60 * 24 * 30));
  session_start();
  if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
}
function user(): ?array { return $_SESSION['user'] ?? null; }
// Writes need the session cookie (SameSite=Lax: never sent by cross-site POSTs)
// and the CSRF token, sent in a custom header (which cross-site pages cannot set).
function require_user(): array {
  $u = user();
  if (!$u) fail(401, 'Sign in with ORCID first.');
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'POST only.');
  if (!hash_equals($_SESSION['csrf'] ?? '', $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) fail(403, 'Invalid session token: reload the page.');
  return $u;
}
function body(): array {
  $b = json_decode(file_get_contents('php://input') ?: '', true);
  if (!is_array($b)) fail(400, 'Expected a JSON body.');
  return $b;
}

// ---- ORCID ----------------------------------------------------------------------
function orcid_valid(string $id): bool { // ISO 7064 11,2 check digit
  if (!preg_match('/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/', $id)) return false;
  $d = str_replace('-', '', $id);
  $t = 0;
  for ($i = 0; $i < 15; $i++) $t = ($t + (int) $d[$i]) * 2;
  $r = (12 - $t % 11) % 11;
  return $d[15] === ($r === 10 ? 'X' : (string) $r);
}
function site_url(): string {
  $c = cfg();
  if (!empty($c['site_url'])) return rtrim($c['site_url'], '/');
  $dir = rtrim(str_replace('\\', '/', dirname(dirname($_SERVER['SCRIPT_NAME']))), '/');
  return (https() ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . $dir;
}
function callback_url(): string { return site_url() . '/api/callback.php'; }

// ---- storage --------------------------------------------------------------------
// data_dir/endorsements.json  {people: {orcid: {name}}, endorsements: [{result, orcid, date}],
//                              reviews: [{item, orcid, verdict, date}], comments: [{id, item, orcid, date, text}]}
//   (reviews and comments: the review page, docs/REVIEW.md; comments there are public)
// data_dir/feedback/<id>.json one file per comment or error report
function data_dir(): string {
  $d = cfg()['data_dir'];
  if (!is_dir($d) && !@mkdir($d, 0700, true)) fail(500, 'Cannot create the data directory.');
  return $d;
}
// Run $fn(state) under an exclusive lock; if it returns an array, save it.
function with_state(callable $fn) {
  $dir = data_dir();
  $lock = fopen("$dir/.lock", 'c');
  flock($lock, LOCK_EX);
  try {
    $file = "$dir/endorsements.json";
    $state = is_file($file) ? json_decode((string) file_get_contents($file), true) : seed_state();
    if (!is_array($state)) fail(500, 'Corrupted endorsements file.');
    $state = with_reviews($state);
    $out = $fn($state);
    if (is_array($out)) {
      $tmp = "$file.tmp";
      file_put_contents($tmp, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
      rename($tmp, $file);
      return $out;
    }
    return $state;
  } finally {
    flock($lock, LOCK_UN);
    fclose($lock);
  }
}
function read_state(): array {
  $file = data_dir() . '/endorsements.json';
  if (!is_file($file)) return seed_state();
  $s = json_decode((string) file_get_contents($file), true);
  return is_array($s) ? with_reviews($s) : seed_state();
}
// First start: the endorsements committed in the repository (via zoo.json).
function seed_state(): array {
  $e = zoo()['endorsements'] ?? [];
  return with_reviews(['people' => (object) ($e['people'] ?? []), 'endorsements' => $e['endorsements'] ?? []]);
}
// The votes and comments committed in data/review.yaml (via review.json), the first
// time the server sees the review page (a state saved before it existed has none).
function with_reviews(array $s): array {
  if (isset($s['reviews'])) return $s;
  $s['reviews'] = [];
  $s['comments'] = [];
  foreach (review_items() as $id => $it) {
    foreach ($it['votes'] ?? [] as $v) $s['reviews'][] = ['item' => $id, 'orcid' => $v['orcid'], 'verdict' => $v['verdict'], 'date' => $v['date']];
    foreach ($it['comments'] ?? [] as $i => $c) $s['comments'][] = ['id' => "$id-c$i", 'item' => $id, 'orcid' => $c['orcid'], 'date' => $c['date'], 'text' => $c['text']];
  }
  return $s;
}
// The items open for review (site/data/review.json, written by the build), by id.
function review_items(): array {
  static $items = null;
  if ($items === null) {
    $items = [];
    $j = json_decode((string) @file_get_contents(cfg()['review_json']), true);
    foreach ($j['items'] ?? [] as $it) $items[$it['id']] = $it;
  }
  return $items;
}
// People are recorded while they have an endorsement, a vote or a comment.
function prune_people(array $s): array {
  $active = array_flip(array_merge(array_column($s['endorsements'] ?? [], 'orcid'), array_column($s['reviews'] ?? [], 'orcid'), array_column($s['comments'] ?? [], 'orcid')));
  $s['people'] = array_intersect_key((array) ($s['people'] ?? []), $active);
  return $s;
}
function zoo(): array {
  static $z = null;
  if ($z === null) {
    $z = json_decode((string) @file_get_contents(cfg()['zoo_json']), true);
    if (!is_array($z)) fail(500, 'Cannot read data/zoo.json.');
  }
  return $z;
}
// The result with this key (scripts/lib/schema.mjs resultKey, stored by the build as _key).
function result_by_key(string $key): ?array {
  foreach (zoo()['results'] as $r) if (($r['_key'] ?? null) === $key) return $r;
  return null;
}

// Refresh the name of a person who has endorsed results (shown with their
// endorsements). Signing in alone publishes nothing.
function record_person(array $u): void {
  with_state(function (array $s) use ($u) {
    $s['people'] = (array) ($s['people'] ?? []);
    if (!isset($s['people'][$u['orcid']]) || $s['people'][$u['orcid']]['name'] === $u['name']) return null;
    $s['people'][$u['orcid']] = ['name' => $u['name']];
    return $s;
  });
}
