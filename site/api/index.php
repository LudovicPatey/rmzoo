<?php
// Endorsement and review server of the RM Zoo (see docs/ENDORSEMENTS.md and docs/REVIEW.md).
//   GET  ?a=state      who is signed in, CSRF token, all endorsements
//   GET  ?a=login      redirect to ORCID (back: the page to return to, a #/… route)
//   GET  ?a=logout     sign out, back to the site
//   POST ?a=endorse    {result: <resultKey>, endorse: true|false}
//   POST ?a=feedback   {kind: error|comment, target: {type, id}, text, page}
//   POST ?a=review     {item: <review item id>, verdict: valid|invalid|null}   (the review page, docs/REVIEW.md)
//   POST ?a=rcomment   {item, text} a public comment on a review item; {delete: <comment id>} removes one's own
//   GET  ?a=uploads    the signed-in person's uploaded full texts (docs/UPLOADS.md)
//   POST ?a=upload     multipart: file (PDF), ref (reference key) or citation, rights=1, replace=<upload id>?
//   POST ?a=unupload   {id} removes one's own upload
//   GET  ?a=export     (admin token) endorsements, votes, comments and all feedback, for scripts/endorsements-sync.mjs
//   GET  ?a=uploads-export        (admin token) the index of all uploads, for scripts/uploads-sync.mjs
//   GET  ?a=upload-file&id=<id>   (admin token) one uploaded file
//   GET  ?a=devlogin   (local development only, config dev_login) sign in as any ORCID iD

declare(strict_types=1);
require __DIR__ . '/lib.php';

$a = $_GET['a'] ?? '';
$safeBack = function (?string $b): string {
  return ($b !== null && preg_match('~^/[A-Za-z0-9/_.,?=&%:+-]*$~', $b)) ? $b : '/';
};

switch ($a) {
  case 'state': {
    start_session();
    $s = read_state();
    json_out(['user' => user(), 'csrf' => $_SESSION['csrf'], 'people' => (object) ($s['people'] ?? []), 'endorsements' => $s['endorsements'] ?? [],
      'reviews' => $s['reviews'], 'comments' => $s['comments']]);
  }

  case 'login': {
    $c = cfg();
    start_session();
    $_SESSION['back'] = $safeBack($_GET['back'] ?? null);
    $_SESSION['oauth_state'] = bin2hex(random_bytes(16));
    redirect($c['orcid_base'] . '/oauth/authorize?' . http_build_query([
      'client_id' => $c['orcid_client_id'], 'response_type' => 'code', 'scope' => '/authenticate',
      'redirect_uri' => callback_url(), 'state' => $_SESSION['oauth_state'],
    ]));
  }

  case 'logout': {
    start_session();
    $back = $safeBack($_GET['back'] ?? null);
    $_SESSION = [];
    session_destroy();
    redirect(site_url() . '/#' . $back);
  }

  case 'devlogin': {
    // never on a public server: needs the config flag AND a request from this machine
    $local = in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true);
    if (!cfg()['dev_login'] || !$local) fail(404, 'Not found.');
    $id = (string) ($_GET['orcid'] ?? '');
    if (!orcid_valid($id)) fail(400, 'Invalid ORCID iD.');
    start_session();
    session_regenerate_id(true);
    $_SESSION['user'] = ['orcid' => $id, 'name' => (string) ($_GET['name'] ?? $id)];
    record_person($_SESSION['user']);
    redirect(site_url() . '/#' . $safeBack($_GET['back'] ?? null));
  }

  case 'endorse': {
    start_session();
    $u = require_user();
    $b = body();
    $key = (string) ($b['result'] ?? '');
    if (!result_by_key($key)) fail(404, 'Unknown result (the database may have changed: reload the page).');
    $on = !empty($b['endorse']);
    $s = with_state(function (array $s) use ($u, $key, $on) {
      $list = array_values(array_filter($s['endorsements'] ?? [], fn ($e) => !($e['result'] === $key && $e['orcid'] === $u['orcid'])));
      if ($on) $list[] = ['result' => $key, 'orcid' => $u['orcid'], 'date' => gmdate('Y-m-d')];
      $s['endorsements'] = $list;
      $s['people'] = (array) ($s['people'] ?? []);
      $s['people'][$u['orcid']] = ['name' => $u['name']];
      return prune_people($s); // people with nothing left are forgotten
    });
    json_out(['people' => (object) $s['people'], 'endorsements' => $s['endorsements']]);
  }

  case 'review': {
    start_session();
    $u = require_user();
    $b = body();
    $item = (string) ($b['item'] ?? '');
    if (!isset(review_items()[$item])) fail(404, 'Unknown or closed review item (reload the page).');
    $verdict = $b['verdict'] ?? null;
    if ($verdict !== null && !in_array($verdict, ['valid', 'invalid'], true)) fail(400, 'verdict: valid, invalid or null.');
    $s = with_state(function (array $s) use ($u, $item, $verdict) {
      $s['reviews'] = array_values(array_filter($s['reviews'], fn ($v) => !($v['item'] === $item && $v['orcid'] === $u['orcid'])));
      if ($verdict !== null) $s['reviews'][] = ['item' => $item, 'orcid' => $u['orcid'], 'verdict' => $verdict, 'date' => gmdate('Y-m-d')];
      $s['people'] = (array) ($s['people'] ?? []);
      $s['people'][$u['orcid']] = ['name' => $u['name']];
      return prune_people($s);
    });
    json_out(['people' => (object) $s['people'], 'reviews' => $s['reviews'], 'comments' => $s['comments']]);
  }

  case 'rcomment': {
    start_session();
    $u = require_user();
    $b = body();
    if (isset($b['delete'])) {
      $cid = (string) $b['delete'];
      $s = with_state(function (array $s) use ($u, $cid) {
        $s['comments'] = array_values(array_filter($s['comments'], fn ($c) => !($c['id'] === $cid && $c['orcid'] === $u['orcid'])));
        return prune_people($s);
      });
      json_out(['people' => (object) $s['people'], 'reviews' => $s['reviews'], 'comments' => $s['comments']]);
    }
    $item = (string) ($b['item'] ?? '');
    if (!isset(review_items()[$item])) fail(404, 'Unknown or closed review item (reload the page).');
    $text = trim((string) ($b['text'] ?? ''));
    if ($text === '' || mb_strlen($text) > 5000) fail(400, 'The comment must have between 1 and 5000 characters.');
    $today = gmdate('Y-m-d');
    $mine = array_filter(read_state()['comments'], fn ($c) => $c['orcid'] === $u['orcid'] && $c['date'] === $today);
    if (count($mine) >= cfg()['feedback_per_day']) fail(429, 'Too many comments today; please try again tomorrow.');
    $s = with_state(function (array $s) use ($u, $item, $text, $today) {
      $s['comments'][] = ['id' => gmdate('Ymd\THis') . '-' . bin2hex(random_bytes(3)), 'item' => $item, 'orcid' => $u['orcid'], 'date' => $today, 'text' => $text];
      $s['people'] = (array) ($s['people'] ?? []);
      $s['people'][$u['orcid']] = ['name' => $u['name']];
      return prune_people($s);
    });
    json_out(['people' => (object) $s['people'], 'reviews' => $s['reviews'], 'comments' => $s['comments']]);
  }

  case 'feedback': {
    start_session();
    $u = require_user();
    $b = body();
    $kind = $b['kind'] ?? '';
    if (!in_array($kind, ['error', 'comment'], true)) fail(400, 'kind: error or comment.');
    $text = trim((string) ($b['text'] ?? ''));
    if ($text === '' || mb_strlen($text) > 10000) fail(400, 'The text must have between 1 and 10000 characters.');
    $t = $b['target'] ?? [];
    $type = $t['type'] ?? 'general';
    if (!in_array($type, ['result', 'statement', 'reference', 'question', 'general'], true)) fail(400, 'Unknown target type.');
    $tid = (string) ($t['id'] ?? '');
    $target = ['type' => $type, 'id' => $tid];
    // make each file self-contained for later processing: the object it is about
    $z = zoo();
    if ($type === 'result') {
      $r = result_by_key($tid);
      if (!$r) fail(404, 'Unknown result.');
      $target['result'] = array_filter($r, fn ($k) => $k[0] !== '_', ARRAY_FILTER_USE_KEY);
    } elseif ($type === 'statement') {
      $st = null;
      foreach ($z['statements'] as $x) if ($x['id'] === $tid) $st = $x;
      if (!$st) fail(404, 'Unknown statement.');
      $target['statement'] = array_intersect_key($st, array_flip(['id', 'label', 'name', 'definition', 'instance', 'solution']));
    } elseif ($type === 'reference') {
      if (!isset($z['references'][$tid])) fail(404, 'Unknown reference.');
      $target['reference'] = array_intersect_key($z['references'][$tid], array_flip(['title', 'authors', 'year', 'venue', 'doi', 'arxiv']));
    }
    $dir = data_dir() . '/feedback';
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    // a simple limit per person and day
    $today = gmdate('Y-m-d');
    $mine = glob("$dir/{$today}T*-{$u['orcid']}-*.json") ?: [];
    if (count($mine) >= cfg()['feedback_per_day']) fail(429, 'Too many messages today; please try again tomorrow.');
    $id = gmdate('Y-m-d\THis\Z') . '-' . $u['orcid'] . '-' . bin2hex(random_bytes(3));
    $rec = [
      'id' => $id, 'date' => gmdate('c'), 'kind' => $kind, 'target' => $target, 'text' => $text,
      'author' => $u, 'page' => mb_substr((string) ($b['page'] ?? ''), 0, 300), 'zooBuiltAt' => $z['builtAt'] ?? null,
    ];
    file_put_contents("$dir/$id.json", json_encode($rec, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    json_out(['ok' => true, 'id' => $id]);
  }

  case 'uploads': {
    start_session();
    $u = user();
    if (!$u) fail(401, 'Sign in with ORCID first.');
    json_out(['uploads' => my_uploads(with_uploads(fn ($l) => null), $u['orcid'])]);
  }

  case 'upload': {
    start_session();
    $u = require_user();
    $c = cfg();
    $f = $_FILES['file'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
      $tooBig = in_array($f['error'] ?? 0, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true);
      fail(400, $tooBig ? "The file is too large (at most {$c['upload_max_mb']} MB)." : 'No file received.');
    }
    if ($f['size'] > $c['upload_max_mb'] * 1024 * 1024) fail(400, "The file is too large (at most {$c['upload_max_mb']} MB).");
    $head = (string) file_get_contents($f['tmp_name'], false, null, 0, 5);
    if ($head !== '%PDF-') fail(400, 'Only PDF files are accepted.');
    if (empty($_POST['rights'])) fail(400, 'Please confirm that you may share this file with the maintainer.');
    $ref = trim((string) ($_POST['ref'] ?? ''));
    $citation = trim((string) ($_POST['citation'] ?? ''));
    if ($ref !== '' && !isset(zoo()['references'][$ref])) fail(404, 'Unknown paper (reload the page).');
    if ($ref === '' && ($citation === '' || mb_strlen($citation) > 500)) fail(400, 'Choose the paper, or describe it (title, authors, year) in at most 500 characters.');
    $replace = (string) ($_POST['replace'] ?? '');
    $today = gmdate('Y-m-d');
    $filename = mb_substr(preg_replace('/[^\p{L}\p{N} ._()-]+/u', '_', basename((string) $f['name'])), 0, 120);
    $sha = hash_file('sha256', $f['tmp_name']);
    $list = with_uploads(function (array $list) use ($u, $c, $f, $ref, $citation, $replace, $today, $filename, $sha) {
      $mine = array_filter($list, fn ($x) => $x['orcid'] === $u['orcid'] && (($x['replaced'] ?? $x['date']) === $today));
      if (count($mine) >= $c['uploads_per_day']) fail(429, 'Too many uploads today; please try again tomorrow.');
      $dir = uploads_dir();
      if ($replace !== '') {
        $i = null;
        foreach ($list as $k => $x) if ($x['id'] === $replace && $x['orcid'] === $u['orcid']) $i = $k;
        if ($i === null) fail(404, 'Unknown upload (reload the page).');
        if (!move_uploaded_file($f['tmp_name'], "$dir/{$replace}.pdf")) fail(500, 'Cannot store the file.');
        $list[$i] = array_merge($list[$i], ['filename' => $filename, 'size' => (int) $f['size'], 'sha256' => $sha, 'replaced' => $today]);
        return $list;
      }
      foreach ($list as $x) if ($x['orcid'] === $u['orcid'] && $x['sha256'] === $sha) fail(409, 'You have already uploaded this file.');
      $id = gmdate('Ymd\THis') . '-' . bin2hex(random_bytes(4));
      if (!move_uploaded_file($f['tmp_name'], "$dir/$id.pdf")) fail(500, 'Cannot store the file.');
      $list[] = array_filter(['id' => $id, 'orcid' => $u['orcid'], 'name' => $u['name'], 'ref' => $ref ?: null, 'citation' => $ref ? null : $citation,
        'filename' => $filename, 'size' => (int) $f['size'], 'sha256' => $sha, 'date' => $today], fn ($v) => $v !== null);
      return $list;
    });
    json_out(['uploads' => my_uploads($list, $u['orcid'])]);
  }

  case 'unupload': {
    start_session();
    $u = require_user();
    $id = (string) (body()['id'] ?? '');
    $list = with_uploads(function (array $list) use ($u, $id) {
      $keep = array_filter($list, fn ($x) => !($x['id'] === $id && $x['orcid'] === $u['orcid']));
      if (count($keep) === count($list)) fail(404, 'Unknown upload (reload the page).');
      @unlink(uploads_dir() . "/$id.pdf");
      return $keep;
    });
    json_out(['uploads' => my_uploads($list, $u['orcid'])]);
  }

  case 'uploads-export':
  case 'upload-file': {
    $tok = cfg()['admin_token'] ?? '';
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (strlen($tok) < 20 || !hash_equals('Bearer ' . $tok, $auth)) fail(403, 'Forbidden.');
    $list = with_uploads(fn ($l) => null);
    if ($a === 'uploads-export') json_out(['uploads' => $list]);
    $id = (string) ($_GET['id'] ?? '');
    if (!preg_match('/^\d{8}T\d{6}-[0-9a-f]{8}$/', $id) || !is_file(uploads_dir() . "/$id.pdf")) fail(404, 'Unknown upload.');
    header('Content-Type: application/pdf');
    header('Cache-Control: no-store');
    readfile(uploads_dir() . "/$id.pdf");
    exit;
  }

  case 'export': {
    $tok = cfg()['admin_token'] ?? '';
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (strlen($tok) < 20 || !hash_equals('Bearer ' . $tok, $auth)) fail(403, 'Forbidden.');
    $s = read_state();
    $fb = [];
    foreach (glob(data_dir() . '/feedback/*.json') ?: [] as $f) $fb[] = json_decode((string) file_get_contents($f), true);
    json_out(['people' => (object) ($s['people'] ?? []), 'endorsements' => $s['endorsements'] ?? [], 'reviews' => $s['reviews'], 'comments' => $s['comments'], 'feedback' => $fb]);
  }

  default:
    fail(404, 'Unknown action.');
}
