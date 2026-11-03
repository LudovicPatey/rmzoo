<?php
// Configuration of the endorsement server. Copy to config.php ON THE SERVER and
// fill in; config.php is never committed (.gitignore). See docs/ENDORSEMENTS.md.
return [
  // ORCID public API client (https://orcid.org/developer-tools), with the
  // redirect URI  https://rmzoo.ludovicpatey.com/api/callback.php
  'orcid_client_id' => 'APP-XXXXXXXXXXXXXXXX',
  'orcid_client_secret' => 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  // 'orcid_base' => 'https://sandbox.orcid.org',   // ORCID's test server

  // Long random string; scripts/endorsements-sync.mjs sends it to download the data
  // (e.g. php -r 'echo bin2hex(random_bytes(24)), "\n";').
  'admin_token' => '',

  // Where endorsements, comments and sessions are stored: OUTSIDE the web root.
  // Default: two levels above api/, i.e. next to www/ on OVH hosting.
  // 'data_dir' => '/home/LOGIN/rmzoo-data',

  // Public address of the site, if it cannot be guessed (proxies…).
  // 'site_url' => 'https://rmzoo.ludovicpatey.com',

  // Local development only: allows ?a=devlogin from this machine (never on a server).
  // 'dev_login' => true,
];
