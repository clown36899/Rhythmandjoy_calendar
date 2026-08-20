<?php

// Connection-scoped TEMPORARY tables shadow production table names. This
// verifies MySQL uniqueness/upsert behavior without writing production stats.

define('RHYTHMJOY_VISITOR_STATS_LIBRARY_ONLY', true);
require dirname(__DIR__) . '/www/calendar_set/calendar_v10/visitor-stats.php';

function visitor_db_selftest_assert($condition, $message) {
    if (!$condition) {
        throw new RuntimeException('visitor-stats DB self-test failed: ' . $message);
    }
}

$env_path = getenv('RHYTHMJOY_ENV_FILE');
if (!$env_path) {
    $env_path = dirname(__DIR__) . '/.env';
}
$env = visitor_read_env_file($env_path);
$secret = visitor_secret($env);
$pdo = visitor_db_connect($env);

$schema_statements = visitor_schema_statements(true);
foreach ($schema_statements as $statement) {
    $pdo->exec($statement);
}

$server = array(
    'HTTP_USER_AGENT' => 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
    'REMOTE_ADDR' => '203.0.113.27',
);
$payload = array(
    'page_path' => '/',
    'referrer_host' => 'search.example',
);
$today = '2098-08-14';
$tomorrow = '2098-08-15';
$identity = str_repeat('d', 24);
$_COOKIE[RHYTHMJOY_VISITOR_COOKIE_NAME] = visitor_issue_cookie_token($identity, $secret);

$first = visitor_record_visit($pdo, $server, $payload, $env, $secret, $today);
$duplicate = visitor_record_visit($pdo, $server, $payload, $env, $secret, $today);

visitor_db_selftest_assert($first['accepted'] && $first['newToday'] && $first['newTotal'], 'first accepted browser creates both unique rows');
visitor_db_selftest_assert($duplicate['accepted'] && !$duplicate['newToday'] && !$duplicate['newTotal'], 'same cookie does not inflate unique counts');

$stats = visitor_read_stats($pdo, $today);
visitor_db_selftest_assert($stats['today'] === 1, 'two page views remain one today visitor');
visitor_db_selftest_assert($stats['total'] === 1, 'two page views remain one total visitor');
visitor_db_selftest_assert($stats['collectionStartedOn'] === $today, 'collection start is derived from accepted data');

$views_statement = $pdo->prepare('SELECT page_views FROM rhythmjoy_site_daily_visitors WHERE visit_date = ?');
$views_statement->execute(array($today));
visitor_db_selftest_assert(intval($views_statement->fetchColumn()) === 2, 'accepted reload is audited as a page view without changing unique counts');

$next_day = visitor_record_visit($pdo, $server, $payload, $env, $secret, $tomorrow);
visitor_db_selftest_assert($next_day['newToday'] && !$next_day['newTotal'], 'same browser is new for a new KST day but not new overall');
$next_stats = visitor_read_stats($pdo, $tomorrow);
visitor_db_selftest_assert($next_stats['today'] === 1 && $next_stats['total'] === 1, 'daily boundary preserves cumulative deduplication');

$network_statement = $pdo->query('SELECT COUNT(DISTINCT network_day_hash) FROM rhythmjoy_site_daily_visitors');
visitor_db_selftest_assert(intval($network_statement->fetchColumn()) === 2, 'network abuse key rotates by KST day');

$limited_env = $env;
$limited_env['RHYTHMJOY_VISITOR_NEW_IDS_PER_IP_DAY'] = '10';
for ($index = 0; $index < 9; $index += 1) {
    $rate_identity = str_pad('rate-' . $index, 24, 'x');
    $_COOKIE[RHYTHMJOY_VISITOR_COOKIE_NAME] = visitor_issue_cookie_token($rate_identity, $secret);
    $rate_result = visitor_record_visit($pdo, $server, $payload, $limited_env, $secret, $today);
    visitor_db_selftest_assert($rate_result['accepted'] && $rate_result['newTotal'], 'new browser below the network cap is accepted');
}
$blocked_identity = str_pad('rate-blocked', 24, 'x');
$_COOKIE[RHYTHMJOY_VISITOR_COOKIE_NAME] = visitor_issue_cookie_token($blocked_identity, $secret);
$blocked = visitor_record_visit($pdo, $server, $payload, $limited_env, $secret, $today);
visitor_db_selftest_assert(!$blocked['accepted'] && !$blocked['newToday'] && !$blocked['newTotal'], 'network cap rejects cookie-reset inflation exactly at the limit');
$limited_stats = visitor_read_stats($pdo, $today);
visitor_db_selftest_assert($limited_stats['today'] === 10 && $limited_stats['total'] === 10, 'rejected identity cannot inflate either exact count');
$limit_statement = $pdo->prepare(
    'SELECT accepted_visitor_count FROM rhythmjoy_site_network_limits WHERE visit_date = ? LIMIT 1'
);
$limit_statement->execute(array($today));
visitor_db_selftest_assert(intval($limit_statement->fetchColumn()) === 10, 'transactional network counter stops at its configured cap');

echo "visitor-stats MySQL self-test OK: exact daily/total uniqueness, reload upsert, KST rollover, rotating network HMAC, transactional inflation cap\n";
