<?php
// Endorsement and review server of the RM Zoo (see docs/ENDORSEMENTS.md and docs/REVIEW.md).
//   GET  ?a=state      who is signed in, CSRF token, all endorsements
//   GET  ?a=login      redirect to ORCID (back: the page to return to, a #/… route)
//   GET  ?a=logout     sign out, back to the site
//   POST ?a=endorse    {result: <resultKey>, endorse: true|false}
//   POST ?a=feedback   {kind: error|comment, target: {type, id}, text, page, replyTo?: <id of one's own message>}
//                      {kind: suggestion, facts: [fact], text, target, page}: facts missing from the database
//                      (target: general, or the question they answer); fact: {type: implication|separation|
//                      equivalence, from, to, over} or {type: property, statement, property, value}, with
//                      source: {ref (a reference key) | citation, loc} and/or justification (the argument)
//   GET  ?a=mine       the signed-in person's own messages and suggestions (private to them)
//   POST ?a=qcomment   {question, text} a public comment on an open question; {delete: <comment id>} removes one's own
//   POST ?a=review     {item: <review item id>, verdict: valid|invalid|null}   (the review page, docs/REVIEW.md)
//   POST ?a=rcomment   {item, text} a public comment on a review item; {delete: <comment id>} removes one's own
//   GET  ?a=uploads    the signed-in person's uploaded full texts (docs/UPLOADS.md)
//   POST ?a=upload     multipart: file (PDF), ref (reference key) or citation, rights=1, replace=<upload id>?
//   POST ?a=unupload   {id} removes one's own upload
//   POST ?a=dismiss    {ref, reason: not-author|not-allowed|null}: a paper of one's own without a
//                      full text that one is not an author of or may not share (null: undo)
//   GET  ?a=diagrams   the signed-in person's saved diagrams (private to them)
//   POST ?a=diagram    {name, s: [statement ids], r: reduction id, sep, open} saves one (a diagram of the same
//                      name is replaced); {delete: <diagram id>} removes one; both answer {diagrams}
//   POST ?a=answer     (admin token) {id: <message id>, text, by: ai|maintainer} adds an answer to a message,
//                      shown to its author (scripts/feedback-answer.mjs); the same text twice is kept once
//   GET  ?a=export     (admin token) endorsements, votes, comments (review items, questions) and all feedback, for scripts/endorsements-sync.mjs
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
      'reviews' => $s['reviews'], 'comments' => $s['comments'], 'qcomments' => $s['qcomments']]);
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
    if (!in_array($kind, ['error', 'comment', 'suggestion'], true)) fail(400, 'kind: error, comment or suggestion.');
    $text = trim((string) ($b['text'] ?? ''));
    if ($kind !== 'suggestion' && $text === '') fail(400, 'The text must have between 1 and 10000 characters.');
    if (mb_strlen($text) > 10000) fail(400, 'The text must have at most 10000 characters.');
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
    } elseif ($type === 'question') {
      $q = null;
      foreach ($z['questions'] ?? [] as $x) if ($x['id'] === $tid) $q = $x;
      if (!$q) fail(404, 'Unknown question.');
      $target['question'] = $q;
    }
    // a suggestion: the facts it proposes, each with a copy of its statements, its source and its argument
    $facts = null;
    if ($kind === 'suggestion') {
      $st = [];
      foreach ($z['statements'] as $x) $st[$x['id']] = $x;
      $red = array_column($z['reductions'], null, 'id');
      $prop = array_column($z['properties'], null, 'id');
      $label = fn ($s) => array_intersect_key($s, array_flip(['id', 'label', 'name']));
      $in = $b['facts'] ?? null;
      if (!is_array($in) || !$in || count($in) > 30) fail(400, 'A suggestion has between 1 and 30 facts.');
      $facts = [];
      foreach ($in as $n => $r) {
        $at = 'Fact ' . ($n + 1) . ': ';
        $rt = $r['type'] ?? '';
        if ($rt === 'property') {
          $s = (string) ($r['statement'] ?? ''); $p = (string) ($r['property'] ?? '');
          if (!isset($st[$s])) fail(404, $at . 'unknown statement.');
          if (!isset($prop[$p])) fail(404, $at . 'unknown property.');
          $f = ['type' => 'property', 'statement' => $s, 'property' => $p, 'value' => !empty($r['value']),
            'statements' => [$label($st[$s])], 'propertyName' => $prop[$p]['name']];
        } elseif (in_array($rt, ['implication', 'separation', 'equivalence'], true)) {
          $from = (string) ($r['from'] ?? ''); $to = (string) ($r['to'] ?? ''); $over = (string) ($r['over'] ?? '');
          if (!isset($st[$from]) || !isset($st[$to])) fail(404, $at . 'unknown statement (choose it from the list).');
          if ($from === $to) fail(400, $at . 'a result relates two different statements.');
          if (!isset($red[$over])) fail(404, $at . 'unknown reduction.');
          $f = ['type' => $rt, 'from' => $from, 'to' => $to, 'over' => $over,
            'statements' => [$label($st[$from]), $label($st[$to])], 'reduction' => $red[$over]['name'] ?? $over];
        } else fail(400, $at . 'type: implication, separation, equivalence or property.');
        $src = is_array($r['source'] ?? null) ? $r['source'] : [];
        $ref = (string) ($src['ref'] ?? ''); $cit = trim((string) ($src['citation'] ?? '')); $loc = trim((string) ($src['loc'] ?? ''));
        $just = trim((string) ($r['justification'] ?? ''));
        if ($ref !== '' && !isset($z['references'][$ref])) fail(404, $at . 'unknown paper (choose it from the list, or write the citation).');
        if (mb_strlen($cit) > 500 || mb_strlen($loc) > 200 || mb_strlen($just) > 5000) fail(400, $at . 'citation (500), location (200) or justification (5000 characters) too long.');
        if ($ref === '' && $cit === '' && $just === '') fail(400, $at . 'give a source (a paper and where in it) or a justification.');
        $f['source'] = array_filter(['ref' => $ref, 'citation' => $cit, 'loc' => $loc], fn ($v) => $v !== '');
        if ($just !== '') $f['justification'] = $just;
        $facts[] = $f;
      }
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
    if ($facts !== null) $rec['facts'] = $facts;
    // a reply to one of one's own messages (to continue after an answer)
    $rt = (string) ($b['replyTo'] ?? '');
    if ($rt !== '') {
      if ($kind !== 'comment' || !preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[0-9X-]{19}-[0-9a-f]{6}$/', $rt)) fail(400, 'Bad reply.');
      $parent = json_decode((string) @file_get_contents("$dir/$rt.json"), true);
      if (!is_array($parent) || ($parent['author']['orcid'] ?? '') !== $u['orcid']) fail(404, 'Unknown message.');
      $rec['replyTo'] = $rt;
    }
    file_put_contents("$dir/$id.json", json_encode($rec, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    json_out(['ok' => true, 'id' => $id]);
  }

  case 'mine': {
    start_session();
    $u = user();
    if (!$u) fail(401, 'Sign in with ORCID first.');
    $out = [];
    foreach (glob(data_dir() . "/feedback/*-{$u['orcid']}-*.json") ?: [] as $f) {
      $x = json_decode((string) file_get_contents($f), true);
      if (is_array($x) && ($x['author']['orcid'] ?? '') === $u['orcid']) $out[] = $x;
    }
    usort($out, fn ($a, $b) => strcmp($b['date'], $a['date']));
    json_out(['messages' => $out]);
  }

  case 'qcomment': {
    start_session();
    $u = require_user();
    $b = body();
    if (isset($b['delete'])) {
      $cid = (string) $b['delete'];
      $s = with_state(function (array $s) use ($u, $cid) {
        $s['qcomments'] = array_values(array_filter($s['qcomments'], fn ($c) => !($c['id'] === $cid && $c['orcid'] === $u['orcid'])));
        return prune_people($s);
      });
      json_out(['people' => (object) $s['people'], 'qcomments' => $s['qcomments']]);
    }
    $q = (string) ($b['question'] ?? '');
    if (!in_array($q, array_column(zoo()['questions'] ?? [], 'id'), true)) fail(404, 'Unknown question (reload the page).');
    $text = trim((string) ($b['text'] ?? ''));
    if ($text === '' || mb_strlen($text) > 5000) fail(400, 'The comment must have between 1 and 5000 characters.');
    $today = gmdate('Y-m-d');
    $st0 = read_state();
    $mine = array_filter(array_merge($st0['comments'], $st0['qcomments']), fn ($c) => $c['orcid'] === $u['orcid'] && $c['date'] === $today);
    if (count($mine) >= cfg()['feedback_per_day']) fail(429, 'Too many comments today; please try again tomorrow.');
    $s = with_state(function (array $s) use ($u, $q, $text, $today) {
      $s['qcomments'][] = ['id' => 'q' . gmdate('Ymd\THis') . '-' . bin2hex(random_bytes(3)), 'question' => $q, 'orcid' => $u['orcid'], 'date' => $today, 'text' => $text];
      $s['people'] = (array) ($s['people'] ?? []);
      $s['people'][$u['orcid']] = ['name' => $u['name']];
      return prune_people($s);
    });
    json_out(['people' => (object) $s['people'], 'qcomments' => $s['qcomments']]);
  }

  case 'uploads': {
    start_session();
    $u = user();
    if (!$u) fail(401, 'Sign in with ORCID first.');
    json_out(['uploads' => my_uploads(with_uploads(fn ($l) => null), $u['orcid']), 'dismissed' => (object) (with_dismissed(fn ($d) => null)[$u['orcid']] ?? [])]);
  }

  case 'dismiss': {
    start_session();
    $u = require_user();
    $b = body();
    $ref = (string) ($b['ref'] ?? '');
    $reason = $b['reason'] ?? null;
    if (!isset(zoo()['references'][$ref])) fail(404, 'Unknown paper (reload the page).');
    if ($reason !== null && !in_array($reason, ['not-author', 'not-allowed'], true)) fail(400, 'reason: not-author, not-allowed or null.');
    $all = with_dismissed(function (array $all) use ($u, $ref, $reason) {
      $mine = $all[$u['orcid']] ?? [];
      if ($reason === null) unset($mine[$ref]); else $mine[$ref] = ['reason' => $reason, 'date' => gmdate('Y-m-d')];
      if ($mine) $all[$u['orcid']] = $mine; else unset($all[$u['orcid']]);
      return $all;
    });
    json_out(['dismissed' => (object) ($all[$u['orcid']] ?? [])]);
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

  case 'diagrams': {
    start_session();
    $u = user();
    if (!$u) fail(401, 'Sign in with ORCID first.');
    json_out(['diagrams' => sorted_diagrams(with_diagrams($u['orcid'], fn ($l) => null))]);
  }

  case 'diagram': {
    start_session();
    $u = require_user();
    $b = body();
    if (isset($b['delete'])) {
      $id = (string) $b['delete'];
      $list = with_diagrams($u['orcid'], function (array $list) use ($id) {
        $keep = array_filter($list, fn ($d) => $d['id'] !== $id);
        if (count($keep) === count($list)) fail(404, 'Unknown diagram (reload the page).');
        return $keep;
      });
      json_out(['diagrams' => sorted_diagrams($list)]);
    }
    $name = trim(preg_replace('/\s+/u', ' ', (string) ($b['name'] ?? '')));
    if ($name === '' || mb_strlen($name) > 100) fail(400, 'The name must have between 1 and 100 characters.');
    $sel = $b['s'] ?? null;
    if (!is_array($sel) || !$sel || count($sel) > 500) fail(400, 'A diagram has between 1 and 500 statements.');
    $z = zoo();
    $known = array_flip(array_column($z['statements'], 'id'));
    $s = [];
    foreach ($sel as $id) {
      $id = (string) $id;
      if (!isset($known[$id])) fail(404, 'Unknown statement ' . mb_substr($id, 0, 60) . ' (reload the page).');
      if (!in_array($id, $s, true)) $s[] = $id;
    }
    $r = (string) ($b['r'] ?? '');
    if (!in_array($r, array_column($z['reductions'], 'id'), true)) fail(404, 'Unknown reduction.');
    $d = ['name' => $name, 's' => $s, 'r' => $r, 'sep' => !empty($b['sep']), 'open' => !empty($b['open'])];
    $list = with_diagrams($u['orcid'], function (array $list) use ($d) {
      $today = gmdate('Y-m-d\TH:i:s\Z');
      foreach ($list as $k => $x) {
        if (mb_strtolower($x['name']) === mb_strtolower($d['name'])) { // same name: replace it, keep its id
          $list[$k] = ['id' => $x['id']] + $d + ['date' => $x['date'], 'updated' => $today];
          return $list;
        }
      }
      if (count($list) >= cfg()['diagrams_max']) fail(429, 'You have saved ' . cfg()['diagrams_max'] . ' diagrams: delete some first.');
      $list[] = ['id' => gmdate('Ymd\THis') . '-' . bin2hex(random_bytes(3))] + $d + ['date' => $today];
      return $list;
    });
    json_out(['diagrams' => sorted_diagrams($list)]);
  }

  case 'uploads-export':
  case 'upload-file': {
    $tok = cfg()['admin_token'] ?? '';
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (strlen($tok) < 20 || !hash_equals('Bearer ' . $tok, $auth)) fail(403, 'Forbidden.');
    $list = with_uploads(fn ($l) => null);
    if ($a === 'uploads-export') json_out(['uploads' => $list, 'dismissed' => (object) with_dismissed(fn ($d) => null)]);
    $id = (string) ($_GET['id'] ?? '');
    if (!preg_match('/^\d{8}T\d{6}-[0-9a-f]{8}$/', $id) || !is_file(uploads_dir() . "/$id.pdf")) fail(404, 'Unknown upload.');
    header('Content-Type: application/pdf');
    header('Cache-Control: no-store');
    readfile(uploads_dir() . "/$id.pdf");
    exit;
  }

  case 'answer': {
    $tok = cfg()['admin_token'] ?? '';
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (strlen($tok) < 20 || !hash_equals('Bearer ' . $tok, $auth)) fail(403, 'Forbidden.');
    $b = body();
    $id = (string) ($b['id'] ?? '');
    if (!preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z-[0-9X-]{19}-[0-9a-f]{6}$/', $id)) fail(400, 'Bad message id.');
    $file = data_dir() . "/feedback/$id.json";
    if (!is_file($file)) fail(404, 'Unknown message.');
    $text = trim((string) ($b['text'] ?? ''));
    if ($text === '' || mb_strlen($text) > 10000) fail(400, 'The answer must have between 1 and 10000 characters.');
    $by = $b['by'] ?? 'maintainer';
    if (!in_array($by, ['ai', 'maintainer'], true)) fail(400, 'by: ai or maintainer.');
    $x = json_decode((string) file_get_contents($file), true);
    if (!is_array($x)) fail(500, 'Unreadable message.');
    $x['answers'] = $x['answers'] ?? [];
    foreach ($x['answers'] as $a) if (($a['text'] ?? '') === $text) json_out(['ok' => true, 'answers' => $x['answers']]);
    $x['answers'][] = ['date' => gmdate('c'), 'text' => $text, 'by' => $by];
    file_put_contents($file, json_encode($x, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    json_out(['ok' => true, 'answers' => $x['answers']]);
  }

  case 'export': {
    $tok = cfg()['admin_token'] ?? '';
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (strlen($tok) < 20 || !hash_equals('Bearer ' . $tok, $auth)) fail(403, 'Forbidden.');
    $s = read_state();
    $fb = [];
    foreach (glob(data_dir() . '/feedback/*.json') ?: [] as $f) $fb[] = json_decode((string) file_get_contents($f), true);
    json_out(['people' => (object) ($s['people'] ?? []), 'endorsements' => $s['endorsements'] ?? [], 'reviews' => $s['reviews'], 'comments' => $s['comments'], 'qcomments' => $s['qcomments'], 'feedback' => $fb]);
  }

  default:
    fail(404, 'Unknown action.');
}
