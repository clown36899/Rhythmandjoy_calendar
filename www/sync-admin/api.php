<?php
date_default_timezone_set('Asia/Seoul');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function json_response($payload, $status_code = 200) {
    http_response_code($status_code);
    echo json_encode($payload);
    exit;
}

function read_env_file($path) {
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

function request_json() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        $data = array();
    }
    foreach ($_POST as $key => $value) {
        $data[$key] = $value;
    }
    return $data;
}

function timing_safe_equals($a, $b) {
    $a = (string) $a;
    $b = (string) $b;
    if (strlen($a) !== strlen($b)) {
        return false;
    }
    $result = 0;
    for ($i = 0; $i < strlen($a); $i += 1) {
        $result |= ord($a[$i]) ^ ord($b[$i]);
    }
    return $result === 0;
}

function require_admin_token($env, $payload) {
    $expected = isset($env['SYNC_ADMIN_TOKEN']) ? trim($env['SYNC_ADMIN_TOKEN']) : '';
    if ($expected === '') {
        json_response(array(
            'ok' => false,
            'error' => 'setup_required',
            'message' => 'SYNC_ADMIN_TOKEN is not configured on the server.',
        ), 503);
    }

    $provided = '';
    if (isset($_SERVER['HTTP_X_RHYTHMJOY_ADMIN_TOKEN'])) {
        $provided = trim($_SERVER['HTTP_X_RHYTHMJOY_ADMIN_TOKEN']);
    } elseif (isset($payload['admin_token'])) {
        $provided = trim($payload['admin_token']);
    } elseif (isset($_GET['admin_token'])) {
        $provided = trim($_GET['admin_token']);
    }

    if ($provided === '' || !timing_safe_equals($expected, $provided)) {
        json_response(array(
            'ok' => false,
            'error' => 'auth_required',
            'message' => '관리 토큰이 필요합니다.',
        ), 401);
    }
}

function require_env($env, $key) {
    if (!isset($env[$key]) || trim($env[$key]) === '') {
        json_response(array(
            'ok' => false,
            'error' => 'db_config_missing',
            'message' => 'Missing DB setting: ' . $key,
        ), 503);
    }
    return $env[$key];
}

function db_connect($env) {
    $host = require_env($env, 'DB_SERVERNAME');
    $port = isset($env['DB_PORT']) && $env['DB_PORT'] !== '' ? intval($env['DB_PORT']) : 3306;
    $name = require_env($env, 'DB_NAME');
    $user = require_env($env, 'DB_USERNAME');
    $password = require_env($env, 'DB_PASSWORD');
    $dsn = 'mysql:host=' . $host . ';port=' . $port . ';dbname=' . $name . ';charset=utf8mb4';
    return new PDO($dsn, $user, $password, array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::MYSQL_ATTR_INIT_COMMAND => 'SET NAMES utf8mb4',
    ));
}

function ensure_schema($pdo) {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_admin_settings (
            setting_key VARCHAR(80) NOT NULL,
            setting_value TEXT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_admin_sessions (
            platform VARCHAR(32) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'needs_check',
            ready_at DATETIME NULL,
            last_checked_at DATETIME NULL,
            note VARCHAR(255) NOT NULL DEFAULT '',
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (platform)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_admin_reservations (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            reservation_key VARCHAR(128) NOT NULL,
            reservation_date DATE NOT NULL,
            room_key VARCHAR(8) NOT NULL,
            start_hour TINYINT UNSIGNED NOT NULL,
            end_hour TINYINT UNSIGNED NOT NULL,
            reserver_name VARCHAR(128) NOT NULL DEFAULT '',
            phone_hash CHAR(64) NOT NULL DEFAULT '',
            phone_last4 VARCHAR(4) NOT NULL DEFAULT '',
            memo VARCHAR(255) NOT NULL DEFAULT '',
            source VARCHAR(32) NOT NULL DEFAULT 'admin',
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_reservation_key (reservation_key),
            KEY idx_date_room (reservation_date, room_key, start_hour, end_hour),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_admin_sync_tasks (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            reservation_id BIGINT UNSIGNED NOT NULL,
            action_type VARCHAR(40) NOT NULL,
            platform VARCHAR(32) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            result_text TEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY idx_reservation (reservation_id),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

function clean_date_value($value) {
    $value = trim((string) $value);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
        return '';
    }
    return $value;
}

function clean_room_value($value) {
    $room = strtoupper(trim((string) $value));
    $allowed = array('A', 'B', 'C', 'D', 'E');
    return in_array($room, $allowed, true) ? $room : '';
}

function clean_hour_value($value, $allow24) {
    if (!is_numeric($value)) {
        return -1;
    }
    $hour = intval($value);
    $max = $allow24 ? 24 : 23;
    return ($hour >= 0 && $hour <= $max) ? $hour : -1;
}

function clean_phone($value) {
    return preg_replace('/\D+/', '', (string) $value);
}

function mask_phone($last4) {
    return $last4 ? '****-' . $last4 : '';
}

function setting_rows($pdo) {
    $settings = array();
    $stmt = $pdo->query("SELECT setting_key, setting_value FROM rhythmjoy_admin_settings");
    foreach ($stmt->fetchAll() as $row) {
        $settings[$row['setting_key']] = $row['setting_value'];
    }
    return $settings;
}

function session_rows($pdo) {
    $sessions = array();
    $stmt = $pdo->query("
        SELECT platform, status, note,
               DATE_FORMAT(ready_at, '%Y-%m-%dT%H:%i:%s+09:00') AS ready_at,
               DATE_FORMAT(last_checked_at, '%Y-%m-%dT%H:%i:%s+09:00') AS last_checked_at
        FROM rhythmjoy_admin_sessions
        ORDER BY platform
    ");
    foreach ($stmt->fetchAll() as $row) {
        $sessions[$row['platform']] = $row;
    }
    return $sessions;
}

function task_summary_rows($pdo) {
    $summary = array();
    $stmt = $pdo->query("
        SELECT reservation_id, platform, status
        FROM rhythmjoy_admin_sync_tasks
        WHERE status <> 'canceled'
        ORDER BY id ASC
    ");
    foreach ($stmt->fetchAll() as $row) {
        $reservation_id = (string) $row['reservation_id'];
        if (!isset($summary[$reservation_id])) {
            $summary[$reservation_id] = array();
        }
        $summary[$reservation_id][$row['platform']] = $row['status'];
    }
    return $summary;
}

function hour_from_time_value($value, $is_end) {
    $value = (string) $value;
    if (!preg_match('/^(\d{2}):(\d{2})/', $value, $matches)) {
        return $is_end ? 24 : 0;
    }
    $hour = intval($matches[1]);
    $minute = intval($matches[2]);
    if ($is_end && $hour === 0 && $minute === 0) {
        return 24;
    }
    if ($is_end && $hour === 23 && $minute >= 45) {
        return 24;
    }
    return $hour;
}

function ledger_reservation_rows($pdo, $date) {
    $stmt = $pdo->prepare("
        SELECT id, ledger_key, source_platform, current_status, target_calendar,
               room_key, reservation_number, reserver_name, product,
               reservation_date,
               TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(end_time, '%H:%i') AS end_time_text,
               DATE_FORMAT(last_event_at, '%Y-%m-%dT%H:%i:%s+09:00') AS last_event_at,
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at,
               DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date = ?
          AND current_status <> 'canceled'
        ORDER BY room_key ASC, start_time ASC, id ASC
    ");
    $stmt->execute(array($date));
    $rows = array();
    foreach ($stmt->fetchAll() as $row) {
        $source = $row['source_platform'] ?: 'ledger';
        $room = strtoupper($row['room_key']);
        $start_hour = hour_from_time_value($row['start_time_text'], false);
        $end_hour = hour_from_time_value($row['end_time_text'], true);
        $rows[] = array(
            'id' => intval($row['id']),
            'key' => $row['ledger_key'],
            'date' => $row['reservation_date'],
            'room' => $room,
            'startHour' => $start_hour,
            'endHour' => $end_hour,
            'name' => $row['reserver_name'],
            'phoneMasked' => '',
            'memo' => $row['reservation_number'] ? '예약번호 ' . $row['reservation_number'] : '',
            'source' => $source,
            'sourceLabel' => $source === 'naver' ? '네이버 원장' : ($source === 'spacecloud' ? '스페이스클라우드 원장' : '예약 원장'),
            'status' => $row['current_status'] ?: 'confirmed',
            'naverStatus' => $source === 'naver' ? 'source' : 'synced',
            'spacecloudStatus' => $source === 'spacecloud' ? 'source' : 'synced',
            'reservationNo' => $row['reservation_number'],
            'product' => $row['product'],
            'createdAt' => $row['created_at'] ?: $row['last_event_at'],
            'updatedAt' => $row['updated_at'] ?: $row['last_event_at'],
        );
    }
    return $rows;
}

function admin_reservation_rows($pdo, $date) {
    $task_summary = task_summary_rows($pdo);
    $stmt = $pdo->prepare("
        SELECT id, reservation_key, reservation_date, room_key, start_hour, end_hour,
               reserver_name, phone_last4, memo, source, status,
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at,
               DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_admin_reservations
        WHERE reservation_date = ? AND status <> 'canceled'
        ORDER BY room_key ASC, start_hour ASC, id ASC
    ");
    $stmt->execute(array($date));
    $rows = array();
    foreach ($stmt->fetchAll() as $row) {
        $reservation_id = (string) $row['id'];
        $summary = isset($task_summary[$reservation_id]) ? $task_summary[$reservation_id] : array();
        $rows[] = array(
            'id' => intval($row['id']),
            'key' => $row['reservation_key'],
            'date' => $row['reservation_date'],
            'room' => strtoupper($row['room_key']),
            'startHour' => intval($row['start_hour']),
            'endHour' => intval($row['end_hour']),
            'name' => $row['reserver_name'],
            'phoneMasked' => mask_phone($row['phone_last4']),
            'memo' => $row['memo'],
            'source' => $row['source'],
            'sourceLabel' => '관리자 입력',
            'status' => $row['status'],
            'naverStatus' => isset($summary['naver']) ? $summary['naver'] : 'pending',
            'spacecloudStatus' => isset($summary['spacecloud']) ? $summary['spacecloud'] : 'pending',
            'reservationNo' => '',
            'product' => '',
            'createdAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
        );
    }
    return $rows;
}

function reservation_rows($pdo, $date) {
    $rows = array_merge(
        ledger_reservation_rows($pdo, $date),
        admin_reservation_rows($pdo, $date)
    );
    usort($rows, function($a, $b) {
        if ($a['room'] === $b['room']) {
            if ($a['startHour'] === $b['startHour']) {
                return strcmp((string) $a['source'], (string) $b['source']);
            }
            return $a['startHour'] < $b['startHour'] ? -1 : 1;
        }
        return strcmp($a['room'], $b['room']);
    });
    return $rows;
}

function recent_task_rows($pdo) {
    $stmt = $pdo->query("
        SELECT t.id, t.reservation_id, t.platform, t.action_type, t.status, t.result_text,
               r.reservation_date, r.room_key, r.start_hour, r.end_hour, r.reserver_name,
               DATE_FORMAT(t.created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at,
               DATE_FORMAT(t.updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_admin_sync_tasks t
        JOIN rhythmjoy_admin_reservations r ON r.id = t.reservation_id
        WHERE t.status <> 'canceled'
        ORDER BY t.id DESC
        LIMIT 80
    ");
    return $stmt->fetchAll();
}

function bootstrap_payload($pdo, $date, $env) {
    $settings = setting_rows($pdo);
    return array(
        'ok' => true,
        'mode' => isset($env['SYNC_ADMIN_ENQUEUE_LIVE_TASKS']) && $env['SYNC_ADMIN_ENQUEUE_LIVE_TASKS'] === '1'
            ? 'db-live-queue'
            : 'db-dry-run',
        'serverTime' => date('c'),
        'settings' => $settings,
        'sessions' => session_rows($pdo),
        'reservations' => reservation_rows($pdo, $date),
        'tasks' => recent_task_rows($pdo),
    );
}

function upsert_setting($pdo, $key, $value) {
    $stmt = $pdo->prepare("
        INSERT INTO rhythmjoy_admin_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()
    ");
    $stmt->execute(array($key, $value));
}

function create_reservation($pdo, $payload) {
    $date = clean_date_value(isset($payload['date']) ? $payload['date'] : '');
    $room = clean_room_value(isset($payload['room']) ? $payload['room'] : '');
    $start = clean_hour_value(isset($payload['start']) ? $payload['start'] : '', false);
    $end = clean_hour_value(isset($payload['end']) ? $payload['end'] : '', true);
    $name = trim((string) (isset($payload['name']) ? $payload['name'] : ''));
    $memo = trim((string) (isset($payload['memo']) ? $payload['memo'] : ''));
    $phone = clean_phone(isset($payload['phone']) ? $payload['phone'] : '');

    if ($date === '' || $room === '' || $start < 0 || $end < 0 || $start >= $end) {
        json_response(array('ok' => false, 'error' => 'invalid_input', 'message' => '예약 날짜, 방, 시간이 올바르지 않습니다.'), 400);
    }
    if ($name === '') {
        json_response(array('ok' => false, 'error' => 'missing_name', 'message' => '예약자명이 필요합니다.'), 400);
    }

    $overlap = $pdo->prepare("
        SELECT id, reserver_name, start_hour, end_hour
        FROM rhythmjoy_admin_reservations
        WHERE reservation_date = ?
          AND room_key = ?
          AND status <> 'canceled'
          AND start_hour < ?
          AND end_hour > ?
        LIMIT 1
    ");
    $overlap->execute(array($date, $room, $end, $start));
    $existing = $overlap->fetch();
    if ($existing) {
        json_response(array(
            'ok' => false,
            'error' => 'overlap',
            'message' => $room . '홀 ' . sprintf('%02d:00-%02d:00', $existing['start_hour'], $existing['end_hour']) . ' 예약과 겹칩니다.',
        ), 409);
    }

    $phone_last4 = $phone !== '' ? substr($phone, -4) : '';
    $phone_hash = $phone !== '' ? hash('sha256', $phone) : '';
    $reservation_key = 'admin:' . strtolower($room) . ':' . $date . ':' . sprintf('%02d-%02d', $start, $end) . ':' . substr(hash('sha256', $name . '|' . $phone . '|' . microtime(true)), 0, 16);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("
            INSERT INTO rhythmjoy_admin_reservations (
                reservation_key, reservation_date, room_key, start_hour, end_hour,
                reserver_name, phone_hash, phone_last4, memo, source, status,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'pending', NOW(), NOW())
        ");
        $stmt->execute(array($reservation_key, $date, $room, $start, $end, $name, $phone_hash, $phone_last4, $memo));
        $reservation_id = intval($pdo->lastInsertId());

        $task = $pdo->prepare("
            INSERT INTO rhythmjoy_admin_sync_tasks (
                reservation_id, action_type, platform, status, result_text, created_at, updated_at
            )
            VALUES (?, ?, ?, 'pending', ?, NOW(), NOW())
        ");
        $task->execute(array($reservation_id, 'block_naver_availability', 'naver', '관리자 패널에서 생성됨'));
        $task->execute(array($reservation_id, 'add_spacecloud_reservation', 'spacecloud', '관리자 패널에서 생성됨'));
        $pdo->commit();
    } catch (Exception $error) {
        $pdo->rollBack();
        throw $error;
    }
}

$env_path = isset($_SERVER['RHYTHMJOY_ENV_FILE']) ? $_SERVER['RHYTHMJOY_ENV_FILE'] : dirname(dirname(__FILE__)) . '/.env';
$env = read_env_file($env_path);
$payload = request_json();
$action = isset($_GET['action']) ? $_GET['action'] : (isset($payload['action']) ? $payload['action'] : 'bootstrap');

if ($action === 'health') {
    json_response(array(
        'ok' => true,
        'serverTime' => date('c'),
        'tokenConfigured' => isset($env['SYNC_ADMIN_TOKEN']) && trim($env['SYNC_ADMIN_TOKEN']) !== '',
        'dbConfigured' => isset($env['DB_SERVERNAME'], $env['DB_USERNAME'], $env['DB_PASSWORD'], $env['DB_NAME']),
    ));
}

require_admin_token($env, $payload);

try {
    $pdo = db_connect($env);
    ensure_schema($pdo);
    $date = clean_date_value(isset($payload['date']) ? $payload['date'] : (isset($_GET['date']) ? $_GET['date'] : date('Y-m-d')));
    if ($date === '') {
        $date = date('Y-m-d');
    }

    if ($action === 'bootstrap') {
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    if ($action === 'create_reservation') {
        create_reservation($pdo, $payload);
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    if ($action === 'clear_drafts') {
        $pdo->exec("UPDATE rhythmjoy_admin_sync_tasks SET status='canceled', updated_at=NOW() WHERE status='pending'");
        $pdo->exec("UPDATE rhythmjoy_admin_reservations SET status='canceled', updated_at=NOW() WHERE source='admin' AND status='pending'");
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    if ($action === 'save_profile') {
        upsert_setting($pdo, 'automation_profile', trim((string) (isset($payload['profilePath']) ? $payload['profilePath'] : '')));
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    if ($action === 'read_check') {
        upsert_setting($pdo, 'last_read_check_at', date('c'));
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    if ($action === 'session_ready') {
        $platform = isset($payload['platform']) ? trim((string) $payload['platform']) : '';
        if (!in_array($platform, array('naver', 'spacecloud'), true)) {
            json_response(array('ok' => false, 'error' => 'invalid_platform', 'message' => '지원하지 않는 플랫폼입니다.'), 400);
        }
        $stmt = $pdo->prepare("
            INSERT INTO rhythmjoy_admin_sessions (platform, status, ready_at, last_checked_at, note, updated_at)
            VALUES (?, 'ready', NOW(), NOW(), '', NOW())
            ON DUPLICATE KEY UPDATE status='ready', ready_at=NOW(), last_checked_at=NOW(), updated_at=NOW()
        ");
        $stmt->execute(array($platform));
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    json_response(array('ok' => false, 'error' => 'unknown_action', 'message' => 'Unknown action: ' . $action), 404);
} catch (Exception $error) {
    json_response(array(
        'ok' => false,
        'error' => 'server_error',
        'message' => $error->getMessage(),
    ), 500);
}
