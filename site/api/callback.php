<?php
// ORCID redirects here after sign-in (the redirect URI registered with ORCID):
// exchange the code for the ORCID iD and name, open the session, go back to the site.
declare(strict_types=1);
require __DIR__ . '/lib.php';

$c = cfg();
start_session();
$back = $_SESSION['back'] ?? '/';
$home = site_url() . '/#' . $back;
if (isset($_GET['error'])) redirect($home); // the person declined
if (!isset($_GET['code'], $_GET['state']) || !hash_equals($_SESSION['oauth_state'] ?? '', (string) $_GET['state'])) {
  http_response_code(400);
  echo 'Sign-in failed (expired or invalid request). <a href="' . htmlspecialchars($home) . '">Back to the zoo</a>';
  exit;
}
unset($_SESSION['oauth_state']);

$ch = curl_init($c['orcid_base'] . '/oauth/token');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT => 20,
  CURLOPT_HTTPHEADER => ['Accept: application/json'],
  CURLOPT_POSTFIELDS => http_build_query([
    'client_id' => $c['orcid_client_id'], 'client_secret' => $c['orcid_client_secret'],
    'grant_type' => 'authorization_code', 'code' => $_GET['code'], 'redirect_uri' => callback_url(),
  ]),
]);
$res = json_decode((string) curl_exec($ch), true);
curl_close($ch);
$orcid = $res['orcid'] ?? '';
if (!orcid_valid($orcid)) {
  http_response_code(502);
  echo 'ORCID did not confirm the sign-in. <a href="' . htmlspecialchars($home) . '">Back to the zoo</a>';
  exit;
}
session_regenerate_id(true);
// the name is the one public on the ORCID record (empty when private)
$_SESSION['user'] = ['orcid' => $orcid, 'name' => trim((string) ($res['name'] ?? '')) ?: $orcid];
record_person($_SESSION['user']);
redirect($home);
