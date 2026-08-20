<?php

/*
 * Rhythmjoy first-party unique-browser statistics.
 *
 * Metric contract:
 * - today: distinct accepted first-party browser IDs seen on the KST date
 * - total: distinct accepted first-party browser IDs since collection began
 *
 * No raw IP address, full user-agent, or full referrer URL is stored. A signed
 * first-party cookie provides deduplication. The daily network key is an HMAC
 * that rotates every KST day and exists only to cap cookie-reset inflation.
 * Keep this file compatible with the production PHP 5.4 runtime.
 */

date_default_timezone_set('Asia/Seoul');

define('RHYTHMJOY_VISITOR_FILTER_VERSION', 'dual-pass-v1-20260814');
define('RHYTHMJOY_VISITOR_COOKIE_NAME', 'rjvid');
define('RHYTHMJOY_VISITOR_COOKIE_MAX_AGE', 31536000);
define('RHYTHMJOY_VISITOR_MIN_VISIBLE_MS', 2500);
define('RHYTHMJOY_VISITOR_CHALLENGE_MAX_MS', 120000);

function visitor_json_response($payload, $status_code) {
    http_response_code($status_code);
    echo json_encode($payload);
    exit;
}

function visitor_read_env_file($path) {
    $env = array();
    if (!is_readable($path)) {
        return $env;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0 || strpos($line, '=') === false) {
            continue;
        }
        list($key, $value) = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        if ($value !== '' && (
            ($value[0] === '"' && substr($value, -1) === '"') ||
            ($value[0] === "'" && substr($value, -1) === "'")
        )) {
            $value = substr($value, 1, -1);
        }
        $env[$key] = $value;
    }
    return $env;
}

function visitor_env_value($env, $key, $default_value) {
    if (!isset($env[$key]) || trim((string) $env[$key]) === '') {
        return $default_value;
    }
    return trim((string) $env[$key]);
}

function visitor_timing_safe_equals($a, $b) {
    $a = (string) $a;
    $b = (string) $b;
    if (strlen($a) !== strlen($b)) {
        return false;
    }
    $result = 0;
    $length = strlen($a);
    for ($i = 0; $i < $length; $i += 1) {
        $result |= ord($a[$i]) ^ ord($b[$i]);
    }
    return $result === 0;
}

function visitor_base64url_encode($raw) {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function visitor_base64url_decode($encoded) {
    if (!is_string($encoded) || $encoded === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $encoded)) {
        return false;
    }
    $padding = strlen($encoded) % 4;
    if ($padding > 0) {
        $encoded .= str_repeat('=', 4 - $padding);
    }
    return base64_decode(strtr($encoded, '-_', '+/'), true);
}

function visitor_random_bytes_compat($length) {
    if (function_exists('openssl_random_pseudo_bytes')) {
        $strong = false;
        $bytes = openssl_random_pseudo_bytes($length, $strong);
        if ($bytes !== false && strlen($bytes) === $length && $strong) {
            return $bytes;
        }
    }
    $handle = @fopen('/dev/urandom', 'rb');
    if ($handle !== false) {
        $bytes = fread($handle, $length);
        fclose($handle);
        if ($bytes !== false && strlen($bytes) === $length) {
            return $bytes;
        }
    }
    throw new RuntimeException('A cryptographically secure random source is unavailable.');
}

function visitor_secret($env) {
    $root_secret = visitor_env_value($env, 'RHYTHMJOY_VISITOR_STATS_SECRET', '');
    if ($root_secret === '') {
        $root_secret = visitor_env_value($env, 'SECRET_KEY', '');
    }
    // A 22-character URL-safe secret commonly represents 128 random bits.
    // Dedicated deployments should still use the 32+ character value shown
    // in ops/env.example.
    if (strlen($root_secret) < 20) {
        throw new RuntimeException('Visitor statistics secret is not configured securely.');
    }
    return hash_hmac('sha256', 'rhythmjoy/visitor-stats/key/v1', $root_secret, true);
}

function visitor_required_env($env, $key) {
    $value = visitor_env_value($env, $key, '');
    if ($value === '') {
        throw new RuntimeException('Missing database configuration.');
    }
    return $value;
}

function visitor_db_connect($env) {
    $host = visitor_required_env($env, 'DB_SERVERNAME');
    $port = intval(visitor_env_value($env, 'DB_PORT', '3306'));
    $database = visitor_required_env($env, 'DB_NAME');
    $username = visitor_required_env($env, 'DB_USERNAME');
    $password = visitor_required_env($env, 'DB_PASSWORD');
    $dsn = 'mysql:host=' . $host . ';port=' . $port . ';dbname=' . $database . ';charset=utf8mb4';
    $pdo = new PDO($dsn, $username, $password, array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::MYSQL_ATTR_INIT_COMMAND => 'SET NAMES utf8mb4',
    ));
    $pdo->exec("SET time_zone = '+09:00'");
    return $pdo;
}

function visitor_schema_statements($temporary) {
    $create = $temporary ? 'CREATE TEMPORARY TABLE' : 'CREATE TABLE IF NOT EXISTS';
    return array(
        "
        $create rhythmjoy_site_visitors (
            visitor_hash CHAR(64) NOT NULL,
            first_seen_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL,
            first_seen_date DATE NOT NULL,
            last_seen_date DATE NOT NULL,
            first_path VARCHAR(191) NOT NULL DEFAULT '',
            last_path VARCHAR(191) NOT NULL DEFAULT '',
            browser_family VARCHAR(32) NOT NULL DEFAULT 'other',
            device_class VARCHAR(16) NOT NULL DEFAULT 'unknown',
            filter_version VARCHAR(32) NOT NULL,
            PRIMARY KEY (visitor_hash),
            KEY idx_first_seen_date (first_seen_date),
            KEY idx_last_seen_date (last_seen_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
        "
        $create rhythmjoy_site_daily_visitors (
            visit_date DATE NOT NULL,
            visitor_hash CHAR(64) NOT NULL,
            network_day_hash CHAR(64) NOT NULL,
            first_seen_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL,
            page_views INT UNSIGNED NOT NULL DEFAULT 1,
            landing_path VARCHAR(191) NOT NULL DEFAULT '',
            last_path VARCHAR(191) NOT NULL DEFAULT '',
            referrer_host VARCHAR(190) NOT NULL DEFAULT '',
            browser_family VARCHAR(32) NOT NULL DEFAULT 'other',
            device_class VARCHAR(16) NOT NULL DEFAULT 'unknown',
            filter_version VARCHAR(32) NOT NULL,
            PRIMARY KEY (visit_date, visitor_hash),
            KEY idx_network_day (visit_date, network_day_hash),
            KEY idx_visitor_date (visitor_hash, visit_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ",
        "
        $create rhythmjoy_site_network_limits (
            visit_date DATE NOT NULL,
            network_day_hash CHAR(64) NOT NULL,
            accepted_visitor_count INT UNSIGNED NOT NULL DEFAULT 0,
            first_seen_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (visit_date, network_day_hash),
            KEY idx_network_limit_date (visit_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    "
    );
}

function visitor_ensure_schema($pdo) {
    $statements = visitor_schema_statements(false);
    foreach ($statements as $statement) {
        $pdo->exec($statement);
    }
}

function visitor_is_missing_table_exception($error) {
    if (!($error instanceof PDOException)) {
        return false;
    }
    if ($error->getCode() === '42S02') {
        return true;
    }
    return isset($error->errorInfo[1]) && intval($error->errorInfo[1]) === 1146;
}

function visitor_read_stats_raw($pdo, $visit_date) {
    $today_statement = $pdo->prepare('SELECT COUNT(*) FROM rhythmjoy_site_daily_visitors WHERE visit_date = ?');
    $today_statement->execute(array($visit_date));
    $visitor_statement = $pdo->query(
        'SELECT COUNT(*) AS total_count, MIN(first_seen_date) AS collection_started_on FROM rhythmjoy_site_visitors'
    );
    $visitor_row = $visitor_statement->fetch();
    return array(
        'today' => intval($today_statement->fetchColumn()),
        'total' => intval($visitor_row['total_count']),
        'collectionStartedOn' => $visitor_row['collection_started_on'] ? (string) $visitor_row['collection_started_on'] : null,
        'asOf' => date('c'),
        'timezone' => 'Asia/Seoul',
        'definition' => 'unique_first_party_browsers',
    );
}

function visitor_read_stats($pdo, $visit_date) {
    try {
        return visitor_read_stats_raw($pdo, $visit_date);
    } catch (PDOException $error) {
        if (!visitor_is_missing_table_exception($error)) {
            throw $error;
        }
        visitor_ensure_schema($pdo);
        return visitor_read_stats_raw($pdo, $visit_date);
    }
}

function visitor_request_json() {
    $raw = file_get_contents('php://input');
    $payload = json_decode($raw, true);
    return is_array($payload) ? $payload : array();
}

function visitor_server_host($server) {
    $raw_host = isset($server['HTTP_HOST']) ? trim((string) $server['HTTP_HOST']) : '';
    if ($raw_host === '') {
        return '';
    }
    $parsed = parse_url('http://' . $raw_host, PHP_URL_HOST);
    return $parsed ? strtolower((string) $parsed) : '';
}

function visitor_source_host($server) {
    $source = '';
    if (isset($server['HTTP_ORIGIN']) && trim((string) $server['HTTP_ORIGIN']) !== '') {
        $source = trim((string) $server['HTTP_ORIGIN']);
    } elseif (isset($server['HTTP_REFERER'])) {
        $source = trim((string) $server['HTTP_REFERER']);
    }
    if ($source === '') {
        return '';
    }
    $host = parse_url($source, PHP_URL_HOST);
    return $host ? strtolower((string) $host) : '';
}

function visitor_request_is_same_origin($server) {
    $server_host = visitor_server_host($server);
    $source_host = visitor_source_host($server);
    if ($server_host === '' || $source_host === '' || $server_host !== $source_host) {
        return false;
    }
    if (isset($server['HTTP_SEC_FETCH_SITE'])) {
        $fetch_site = strtolower(trim((string) $server['HTTP_SEC_FETCH_SITE']));
        if ($fetch_site !== '' && $fetch_site !== 'same-origin' && $fetch_site !== 'none') {
            return false;
        }
    }
    return true;
}

function visitor_request_envelope_is_valid($server) {
    return isset($server['HTTP_X_RHYTHMJOY_VISIT']) &&
        trim((string) $server['HTTP_X_RHYTHMJOY_VISIT']) === '1' &&
        visitor_request_is_same_origin($server);
}

function visitor_remote_ip($server) {
    if (!isset($server['REMOTE_ADDR'])) {
        return '';
    }
    $ip = trim((string) $server['REMOTE_ADDR']);
    $packed = @inet_pton($ip);
    if ($packed === false) {
        return '';
    }
    $normalized = @inet_ntop($packed);
    return $normalized === false ? '' : strtolower($normalized);
}

function visitor_ip_in_cidr($ip, $cidr) {
    $parts = explode('/', trim((string) $cidr), 2);
    $network = trim($parts[0]);
    $ip_bytes = @inet_pton($ip);
    $network_bytes = @inet_pton($network);
    if ($ip_bytes === false || $network_bytes === false || strlen($ip_bytes) !== strlen($network_bytes)) {
        return false;
    }
    $max_bits = strlen($ip_bytes) * 8;
    $prefix = count($parts) === 2 ? intval($parts[1]) : $max_bits;
    if ($prefix < 0 || $prefix > $max_bits) {
        return false;
    }
    $whole_bytes = intval(floor($prefix / 8));
    $remaining_bits = $prefix % 8;
    if ($whole_bytes > 0 && substr($ip_bytes, 0, $whole_bytes) !== substr($network_bytes, 0, $whole_bytes)) {
        return false;
    }
    if ($remaining_bits === 0) {
        return true;
    }
    $mask = (0xFF << (8 - $remaining_bits)) & 0xFF;
    return (ord($ip_bytes[$whole_bytes]) & $mask) === (ord($network_bytes[$whole_bytes]) & $mask);
}

function visitor_ip_is_excluded($ip, $env) {
    $configured = visitor_env_value($env, 'RHYTHMJOY_VISITOR_EXCLUDED_IPS', '');
    if ($configured === '') {
        return false;
    }
    $entries = explode(',', $configured);
    foreach ($entries as $entry) {
        $entry = trim($entry);
        if ($entry !== '' && visitor_ip_in_cidr($ip, $entry)) {
            return true;
        }
    }
    return false;
}

function visitor_valid_page_path($path) {
    $allowed = array(
        '/',
        '/calendar_set/calendar_v10/calendar_10.html',
        '/calendar_set/calendar_v10/calendar_mobile_10.html',
    );
    return is_string($path) && in_array($path, $allowed, true);
}

function visitor_known_bot_user_agent($user_agent) {
    if ($user_agent === '') {
        return true;
    }
    return preg_match(
        '~(?:bot\b|spider|crawler|crawl\b|slurp|bingpreview|googleother|google-inspectiontool|mediapartners-google|facebookexternalhit|facebot|twitterbot|linkedinbot|pinterest|embedly|quora link preview|showyoubot|outbrain|vkshare|w3c_validator|lighthouse|pagespeed|headlesschrome|phantomjs|selenium|playwright|puppeteer|curl/|wget/|python-requests|python-urllib|aiohttp|go-http-client|libwww-perl|scrapy|httpunit|node-fetch|axios/|postmanruntime|uptimerobot|nagios|zgrab|masscan|censysinspect|netcraftsurveyagent|ia_archiver|archive\.org_bot|bytespider|petalbot|semrush|ahrefs|mj12bot|dotbot|dataforseo|applebot|duckduckbot|yandexbot|baiduspider|yeti/|daumoa|chatgpt-user|anthropic-ai|cohere-ai|meta-externalagent)~i',
        $user_agent
    ) === 1;
}

function visitor_plausible_browser_user_agent($user_agent) {
    if (strlen($user_agent) < 20 || strlen($user_agent) > 768 || strpos($user_agent, 'Mozilla/5.0') !== 0) {
        return false;
    }
    return preg_match('~(?:AppleWebKit/|Gecko/|Firefox/|Chrome/|CriOS/|FxiOS/|Safari/|Edg(?:e|A|iOS)?/|OPR/|SamsungBrowser/|Whale/)~i', $user_agent) === 1;
}

function visitor_browser_family($user_agent) {
    $families = array(
        'Samsung Internet' => '~SamsungBrowser/~i',
        'Naver Whale' => '~Whale/~i',
        'Edge' => '~Edg(?:e|A|iOS)?/~i',
        'Opera' => '~(?:OPR/|Opera/)~i',
        'Firefox' => '~(?:Firefox/|FxiOS/)~i',
        'Chrome' => '~(?:Chrome/|CriOS/)~i',
        'Safari' => '~Safari/~i',
        'WebView' => '~AppleWebKit/~i',
    );
    foreach ($families as $family => $pattern) {
        if (preg_match($pattern, $user_agent)) {
            return $family;
        }
    }
    return 'other';
}

function visitor_device_class($user_agent) {
    if (preg_match('~(?:iPad|Tablet|Nexus 7|Nexus 9|SM-T|Tab)~i', $user_agent)) {
        return 'tablet';
    }
    if (preg_match('~(?:Mobile|Android|iPhone|iPod)~i', $user_agent)) {
        return 'mobile';
    }
    return 'desktop';
}

function visitor_is_browser_candidate($server) {
    $ip = visitor_remote_ip($server);
    $user_agent = isset($server['HTTP_USER_AGENT']) ? trim((string) $server['HTTP_USER_AGENT']) : '';
    if ($ip === '') {
        return false;
    }
    if (visitor_known_bot_user_agent($user_agent) || !visitor_plausible_browser_user_agent($user_agent)) {
        return false;
    }
    return true;
}

function visitor_client_is_eligible($server, $payload, $env, $require_signals) {
    $ip = visitor_remote_ip($server);
    if (!visitor_is_browser_candidate($server) || visitor_ip_is_excluded($ip, $env)) {
        return false;
    }
    if (!$require_signals) {
        return true;
    }
    if (!empty($payload['webdriver'])) {
        return false;
    }
    $visible_ms = isset($payload['visible_ms']) ? intval($payload['visible_ms']) : 0;
    $screen_width = isset($payload['screen_width']) ? intval($payload['screen_width']) : 0;
    $screen_height = isset($payload['screen_height']) ? intval($payload['screen_height']) : 0;
    if ($visible_ms < RHYTHMJOY_VISITOR_MIN_VISIBLE_MS || $visible_ms > 86400000) {
        return false;
    }
    if ($screen_width < 1 || $screen_height < 1 || $screen_width > 20000 || $screen_height > 20000) {
        return false;
    }
    return true;
}

function visitor_client_binding($ip, $user_agent, $secret) {
    return substr(hash_hmac('sha256', $ip . "\n" . $user_agent, $secret), 0, 32);
}

function visitor_issue_challenge($server, $page_path, $secret, $now_ms) {
    $ip = visitor_remote_ip($server);
    $user_agent = isset($server['HTTP_USER_AGENT']) ? trim((string) $server['HTTP_USER_AGENT']) : '';
    $payload = array(
        'v' => 1,
        'iat' => intval($now_ms),
        'nonce' => visitor_base64url_encode(visitor_random_bytes_compat(18)),
        'binding' => visitor_client_binding($ip, $user_agent, $secret),
        'path' => $page_path,
    );
    $encoded = visitor_base64url_encode(json_encode($payload));
    $signature = visitor_base64url_encode(hash_hmac('sha256', $encoded, $secret, true));
    return $encoded . '.' . $signature;
}

function visitor_verify_challenge($token, $server, $page_path, $secret, $now_ms) {
    if (!is_string($token) || substr_count($token, '.') !== 1) {
        return false;
    }
    list($encoded, $provided_signature) = explode('.', $token, 2);
    $expected_signature = visitor_base64url_encode(hash_hmac('sha256', $encoded, $secret, true));
    if (!visitor_timing_safe_equals($expected_signature, $provided_signature)) {
        return false;
    }
    $decoded = visitor_base64url_decode($encoded);
    if ($decoded === false) {
        return false;
    }
    $payload = json_decode($decoded, true);
    if (!is_array($payload) || !isset($payload['v'], $payload['iat'], $payload['nonce'], $payload['binding'], $payload['path'])) {
        return false;
    }
    if (intval($payload['v']) !== 1 || (string) $payload['path'] !== (string) $page_path) {
        return false;
    }
    $issued_at = intval($payload['iat']);
    $age = intval($now_ms) - $issued_at;
    if ($age < RHYTHMJOY_VISITOR_MIN_VISIBLE_MS || $age > RHYTHMJOY_VISITOR_CHALLENGE_MAX_MS) {
        return false;
    }
    if (!preg_match('/^[A-Za-z0-9_-]{20,40}$/', (string) $payload['nonce'])) {
        return false;
    }
    $ip = visitor_remote_ip($server);
    $user_agent = isset($server['HTTP_USER_AGENT']) ? trim((string) $server['HTTP_USER_AGENT']) : '';
    $expected_binding = visitor_client_binding($ip, $user_agent, $secret);
    return visitor_timing_safe_equals($expected_binding, (string) $payload['binding']);
}

function visitor_issue_cookie_token($identity, $secret) {
    $encoded_identity = visitor_base64url_encode($identity);
    $signature = visitor_base64url_encode(hash_hmac('sha256', 'v1.' . $encoded_identity, $secret, true));
    return 'v1.' . $encoded_identity . '.' . $signature;
}

function visitor_verify_cookie_token($token, $secret) {
    if (!is_string($token)) {
        return false;
    }
    $parts = explode('.', $token);
    if (count($parts) !== 3 || $parts[0] !== 'v1') {
        return false;
    }
    $expected = visitor_base64url_encode(hash_hmac('sha256', 'v1.' . $parts[1], $secret, true));
    if (!visitor_timing_safe_equals($expected, $parts[2])) {
        return false;
    }
    $identity = visitor_base64url_decode($parts[1]);
    return $identity !== false && strlen($identity) === 24 ? $identity : false;
}

function visitor_set_identity_cookie($token) {
    $expires = time() + RHYTHMJOY_VISITOR_COOKIE_MAX_AGE;
    $cookie = RHYTHMJOY_VISITOR_COOKIE_NAME . '=' . $token .
        '; Max-Age=' . RHYTHMJOY_VISITOR_COOKIE_MAX_AGE .
        '; Expires=' . gmdate('D, d M Y H:i:s', $expires) . ' GMT' .
        '; Path=/; Secure; HttpOnly; SameSite=Lax';
    header('Set-Cookie: ' . $cookie, false);
}

function visitor_clean_referrer_host($value) {
    $value = strtolower(trim((string) $value));
    if ($value === '' || strlen($value) > 190 || !preg_match('/^[a-z0-9.-]+$/', $value)) {
        return '';
    }
    return $value;
}

function visitor_new_id_limit($env) {
    $limit = intval(visitor_env_value($env, 'RHYTHMJOY_VISITOR_NEW_IDS_PER_IP_DAY', '100'));
    if ($limit < 10) {
        return 10;
    }
    if ($limit > 1000) {
        return 1000;
    }
    return $limit;
}

function visitor_record_visit($pdo, $server, $payload, $env, $secret, $visit_date) {
    $cookie_token = isset($_COOKIE[RHYTHMJOY_VISITOR_COOKIE_NAME]) ? (string) $_COOKIE[RHYTHMJOY_VISITOR_COOKIE_NAME] : '';
    $identity = visitor_verify_cookie_token($cookie_token, $secret);
    if ($identity === false) {
        $identity = visitor_random_bytes_compat(24);
        $cookie_token = visitor_issue_cookie_token($identity, $secret);
    }

    $visitor_hash = hash_hmac('sha256', 'visitor:' . $identity, $secret);
    $ip = visitor_remote_ip($server);
    $network_day_hash = hash_hmac('sha256', 'network-day:' . $visit_date . ':' . $ip, $secret);
    $user_agent = isset($server['HTTP_USER_AGENT']) ? trim((string) $server['HTTP_USER_AGENT']) : '';
    $browser_family = visitor_browser_family($user_agent);
    $device_class = visitor_device_class($user_agent);
    $page_path = (string) $payload['page_path'];
    $referrer_host = visitor_clean_referrer_host(isset($payload['referrer_host']) ? $payload['referrer_host'] : '');
    $now = date('Y-m-d H:i:s');
    $accepted = true;
    $new_today = false;
    $new_total = false;

    $pdo->beginTransaction();
    try {
        $existing_daily_statement = $pdo->prepare(
            'SELECT visitor_hash FROM rhythmjoy_site_daily_visitors ' .
            'WHERE visit_date = ? AND visitor_hash = ? LIMIT 1 FOR UPDATE'
        );
        $existing_daily_statement->execute(array($visit_date, $visitor_hash));
        $existing_daily = $existing_daily_statement->fetch();

        if (!$existing_daily) {
            $limit_row_statement = $pdo->prepare("
                INSERT INTO rhythmjoy_site_network_limits (
                    visit_date, network_day_hash, accepted_visitor_count, first_seen_at, updated_at
                ) VALUES (?, ?, 0, ?, ?)
                ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)
            ");
            $limit_row_statement->execute(array($visit_date, $network_day_hash, $now, $now));
            $limit_statement = $pdo->prepare(
                'SELECT accepted_visitor_count FROM rhythmjoy_site_network_limits ' .
                'WHERE visit_date = ? AND network_day_hash = ? FOR UPDATE'
            );
            $limit_statement->execute(array($visit_date, $network_day_hash));
            if (intval($limit_statement->fetchColumn()) >= visitor_new_id_limit($env)) {
                $accepted = false;
            }
        }

        if ($accepted) {
            $visitor_statement = $pdo->prepare("
                INSERT INTO rhythmjoy_site_visitors (
                    visitor_hash, first_seen_at, last_seen_at, first_seen_date, last_seen_date,
                    first_path, last_path, browser_family, device_class, filter_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    last_seen_at = VALUES(last_seen_at),
                    last_seen_date = VALUES(last_seen_date),
                    last_path = VALUES(last_path),
                    browser_family = VALUES(browser_family),
                    device_class = VALUES(device_class),
                    filter_version = VALUES(filter_version)
            ");
            $visitor_statement->execute(array(
                $visitor_hash, $now, $now, $visit_date, $visit_date,
                $page_path, $page_path, $browser_family, $device_class, RHYTHMJOY_VISITOR_FILTER_VERSION,
            ));
            $new_total = $visitor_statement->rowCount() === 1;

            $daily_statement = $pdo->prepare("
                INSERT INTO rhythmjoy_site_daily_visitors (
                    visit_date, visitor_hash, network_day_hash, first_seen_at, last_seen_at,
                    page_views, landing_path, last_path, referrer_host,
                    browser_family, device_class, filter_version
                ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    last_seen_at = VALUES(last_seen_at),
                    page_views = IF(page_views < 4294967295, page_views + 1, page_views),
                    last_path = VALUES(last_path),
                    browser_family = VALUES(browser_family),
                    device_class = VALUES(device_class),
                    filter_version = VALUES(filter_version)
            ");
            $daily_statement->execute(array(
                $visit_date, $visitor_hash, $network_day_hash, $now, $now,
                $page_path, $page_path, $referrer_host,
                $browser_family, $device_class, RHYTHMJOY_VISITOR_FILTER_VERSION,
            ));
            $new_today = $daily_statement->rowCount() === 1;
            if ($new_today) {
                $increment_limit_statement = $pdo->prepare("
                    UPDATE rhythmjoy_site_network_limits
                    SET accepted_visitor_count = accepted_visitor_count + 1, updated_at = ?
                    WHERE visit_date = ? AND network_day_hash = ?
                ");
                $increment_limit_statement->execute(array($now, $visit_date, $network_day_hash));
            }
        }
        $pdo->commit();
    } catch (Exception $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }

    visitor_set_identity_cookie($cookie_token);
    return array(
        'accepted' => $accepted,
        'newToday' => $new_today,
        'newTotal' => $new_total,
    );
}

function visitor_record_visit_with_schema_retry($pdo, $server, $payload, $env, $secret, $visit_date) {
    try {
        return visitor_record_visit($pdo, $server, $payload, $env, $secret, $visit_date);
    } catch (PDOException $error) {
        if (!visitor_is_missing_table_exception($error)) {
            throw $error;
        }
        visitor_ensure_schema($pdo);
        return visitor_record_visit($pdo, $server, $payload, $env, $secret, $visit_date);
    }
}

function visitor_selftest_assert($condition, $message) {
    if (!$condition) {
        throw new RuntimeException('visitor-stats self-test failed: ' . $message);
    }
}

function visitor_run_selftest() {
    $env = array('RHYTHMJOY_VISITOR_STATS_SECRET' => str_repeat('s', 48));
    $secret = visitor_secret($env);
    $browser_ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36';
    $server = array(
        'HTTP_HOST' => 'example.test',
        'HTTP_REFERER' => 'https://example.test/',
        'HTTP_SEC_FETCH_SITE' => 'same-origin',
        'HTTP_X_RHYTHMJOY_VISIT' => '1',
        'HTTP_USER_AGENT' => $browser_ua,
        'REMOTE_ADDR' => '203.0.113.27',
    );
    $signals = array(
        'webdriver' => false,
        'visible_ms' => 2600,
        'screen_width' => 390,
        'screen_height' => 844,
        'page_path' => '/',
    );

    visitor_selftest_assert(visitor_request_envelope_is_valid($server), 'same-origin browser request is accepted');
    visitor_selftest_assert(visitor_client_is_eligible($server, $signals, $env, true), 'normal browser signals pass');
    visitor_selftest_assert(!visitor_known_bot_user_agent($browser_ua), 'normal Chrome is not classified as a bot');
    visitor_selftest_assert(visitor_browser_family($browser_ua) === 'Chrome', 'browser family is classified');
    visitor_selftest_assert(visitor_device_class($browser_ua) === 'mobile', 'device class is classified');

    $safari_server = $server;
    $safari_server['HTTP_USER_AGENT'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1';
    visitor_selftest_assert(visitor_client_is_eligible($safari_server, $signals, $env, false), 'mobile Safari passes the browser allow-pass');
    $samsung_server = $server;
    $samsung_server['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 SamsungBrowser/26.0';
    visitor_selftest_assert(visitor_client_is_eligible($samsung_server, $signals, $env, false), 'Samsung Internet passes the browser allow-pass');

    $bot_server = $server;
    $bot_server['HTTP_USER_AGENT'] = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    visitor_selftest_assert(!visitor_client_is_eligible($bot_server, $signals, $env, false), 'known crawler is rejected');
    $headless_server = $server;
    $headless_server['HTTP_USER_AGENT'] = 'Mozilla/5.0 AppleWebKit/537.36 HeadlessChrome/126.0.0.0 Safari/537.36';
    visitor_selftest_assert(!visitor_client_is_eligible($headless_server, $signals, $env, false), 'headless browser is rejected');
    $cli_server = $server;
    $cli_server['HTTP_USER_AGENT'] = 'curl/8.7.1';
    visitor_selftest_assert(!visitor_client_is_eligible($cli_server, $signals, $env, false), 'non-browser HTTP client is rejected');
    $automated = $signals;
    $automated['webdriver'] = true;
    visitor_selftest_assert(!visitor_client_is_eligible($server, $automated, $env, true), 'webdriver automation is rejected');
    $too_short = $signals;
    $too_short['visible_ms'] = 200;
    visitor_selftest_assert(!visitor_client_is_eligible($server, $too_short, $env, true), 'short visibility is rejected');

    $issued_at = 1700000000000;
    $challenge = visitor_issue_challenge($server, '/', $secret, $issued_at);
    visitor_selftest_assert(
        visitor_verify_challenge($challenge, $server, '/', $secret, $issued_at + 2600),
        'signed challenge passes after real dwell time'
    );
    visitor_selftest_assert(
        !visitor_verify_challenge($challenge, $server, '/', $secret, $issued_at + 100),
        'challenge cannot be submitted immediately'
    );
    $changed_ip = $server;
    $changed_ip['REMOTE_ADDR'] = '203.0.113.28';
    visitor_selftest_assert(
        !visitor_verify_challenge($challenge, $changed_ip, '/', $secret, $issued_at + 2600),
        'challenge is bound to the requesting client network and UA'
    );

    $identity = str_repeat('i', 24);
    $cookie = visitor_issue_cookie_token($identity, $secret);
    visitor_selftest_assert(visitor_verify_cookie_token($cookie, $secret) === $identity, 'signed cookie round-trips');
    visitor_selftest_assert(visitor_verify_cookie_token($cookie . 'x', $secret) === false, 'tampered cookie is rejected');
    visitor_selftest_assert(visitor_ip_in_cidr('203.0.113.27', '203.0.113.0/24'), 'IPv4 CIDR matches');
    visitor_selftest_assert(!visitor_ip_in_cidr('203.0.114.27', '203.0.113.0/24'), 'IPv4 CIDR mismatch is rejected');
    visitor_selftest_assert(visitor_ip_in_cidr('2001:db8::27', '2001:db8::/48'), 'IPv6 CIDR matches');
    visitor_selftest_assert(visitor_valid_page_path('/'), 'canonical root path is accepted');
    visitor_selftest_assert(!visitor_valid_page_path('/sync-admin/'), 'unrelated paths cannot be counted');
    $cross_origin_server = $server;
    $cross_origin_server['HTTP_REFERER'] = 'https://attacker.example/';
    visitor_selftest_assert(!visitor_request_envelope_is_valid($cross_origin_server), 'cross-origin request is rejected');
    $excluded_env = $env;
    $excluded_env['RHYTHMJOY_VISITOR_EXCLUDED_IPS'] = '198.51.100.0/24, 203.0.113.27';
    visitor_selftest_assert(visitor_ip_is_excluded('203.0.113.27', $excluded_env), 'configured internal address is excluded');

    echo "visitor-stats self-test OK: signed identity/challenge, dwell time, same-origin, major-browser allow-pass, crawler/headless/automation deny-pass, CIDR exclusion\n";
}

if (PHP_SAPI === 'cli' && isset($argv[1]) && $argv[1] === 'self-test') {
    visitor_run_selftest();
    exit(0);
}

if (defined('RHYTHMJOY_VISITOR_STATS_LIBRARY_ONLY') && RHYTHMJOY_VISITOR_STATS_LIBRARY_ONLY) {
    return;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : 'GET';
$payload = $method === 'POST' ? visitor_request_json() : array();
$action = isset($_GET['action']) ? (string) $_GET['action'] : ($method === 'POST' ? 'confirm' : 'stats');

if (($method !== 'GET' && $method !== 'POST') || !visitor_request_envelope_is_valid($_SERVER)) {
    header('Allow: GET, POST');
    visitor_json_response(array('ok' => false, 'error' => 'request_rejected'), 403);
}

$env_path = isset($_SERVER['RHYTHMJOY_ENV_FILE'])
    ? (string) $_SERVER['RHYTHMJOY_ENV_FILE']
    : dirname(dirname(dirname(__FILE__))) . '/.env';

try {
    $env = visitor_read_env_file($env_path);
    $secret = visitor_secret($env);
    $visit_date = date('Y-m-d');
    $browser_candidate = visitor_is_browser_candidate($_SERVER);

    if (!$browser_candidate) {
        if ($method === 'GET' && $action === 'challenge') {
            visitor_json_response(array(
                'ok' => true,
                'eligible' => false,
                'stats' => null,
                'minimumVisibleMs' => RHYTHMJOY_VISITOR_MIN_VISIBLE_MS,
            ), 200);
        }
        if ($method === 'GET' && $action === 'stats') {
            visitor_json_response(array('ok' => true, 'stats' => null), 200);
        }
        if ($method === 'POST' && $action === 'confirm') {
            visitor_json_response(array('ok' => true, 'accepted' => false, 'stats' => null), 200);
        }
    }

    $page_path = '';
    $eligible = false;
    if ($method === 'GET' && $action === 'challenge') {
        $page_path = isset($_GET['page_path']) ? (string) $_GET['page_path'] : '';
        if (!visitor_valid_page_path($page_path)) {
            visitor_json_response(array(
                'ok' => true,
                'eligible' => false,
                'stats' => null,
                'minimumVisibleMs' => RHYTHMJOY_VISITOR_MIN_VISIBLE_MS,
            ), 200);
        }
        $eligible = visitor_client_is_eligible($_SERVER, array(), $env, false);
    }

    if ($method === 'POST' && $action === 'confirm') {
        $page_path = isset($payload['page_path']) ? (string) $payload['page_path'] : '';
        $challenge = isset($payload['challenge']) ? (string) $payload['challenge'] : '';
        $now_ms = intval(round(microtime(true) * 1000));
        $eligible = visitor_valid_page_path($page_path) &&
            visitor_client_is_eligible($_SERVER, $payload, $env, true) &&
            visitor_verify_challenge($challenge, $_SERVER, $page_path, $secret, $now_ms);
        if (!$eligible) {
            visitor_json_response(array('ok' => true, 'accepted' => false, 'stats' => null), 200);
        }
    }

    $pdo = visitor_db_connect($env);
    $stats = visitor_read_stats($pdo, $visit_date);

    if ($method === 'GET' && $action === 'stats') {
        visitor_json_response(array('ok' => true, 'stats' => $stats), 200);
    }

    if ($method === 'GET' && $action === 'challenge') {
        $response = array(
            'ok' => true,
            'eligible' => $eligible,
            'stats' => $stats,
            'minimumVisibleMs' => RHYTHMJOY_VISITOR_MIN_VISIBLE_MS,
        );
        if ($eligible) {
            $response['challenge'] = visitor_issue_challenge(
                $_SERVER,
                $page_path,
                $secret,
                intval(round(microtime(true) * 1000))
            );
        }
        visitor_json_response($response, 200);
    }

    if ($method === 'POST' && $action === 'confirm') {
        $record = visitor_record_visit_with_schema_retry($pdo, $_SERVER, $payload, $env, $secret, $visit_date);
        $stats = visitor_read_stats($pdo, $visit_date);
        visitor_json_response(array(
            'ok' => true,
            'accepted' => $record['accepted'],
            'newToday' => $record['newToday'],
            'newTotal' => $record['newTotal'],
            'stats' => $stats,
        ), 200);
    }

    visitor_json_response(array('ok' => false, 'error' => 'unknown_action'), 404);
} catch (Exception $error) {
    error_log('[visitor-stats] ' . get_class($error) . ': ' . $error->getMessage());
    visitor_json_response(array(
        'ok' => false,
        'error' => 'statistics_unavailable',
        'message' => '방문자 통계를 잠시 불러올 수 없습니다.',
    ), 503);
}
