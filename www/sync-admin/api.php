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
            'message' => '관리자 인증 설정 확인이 필요합니다.',
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

function ensure_column($pdo, $table, $column, $definition) {
    $stmt = $pdo->prepare("SHOW TABLES LIKE ?");
    $stmt->execute(array($table));
    if (!$stmt->fetch()) {
        return;
    }
    $stmt = $pdo->prepare("SHOW COLUMNS FROM `$table` LIKE ?");
    $stmt->execute(array($column));
    if (!$stmt->fetch()) {
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column` $definition");
    }
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
        CREATE TABLE IF NOT EXISTS rhythmjoy_admin_series (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            series_key VARCHAR(128) NOT NULL,
            title VARCHAR(128) NOT NULL DEFAULT '',
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            fifth_week_policy VARCHAR(16) NOT NULL DEFAULT 'include',
            definition_json MEDIUMTEXT NULL,
            reserver_name VARCHAR(128) NOT NULL DEFAULT '',
            phone_hash CHAR(64) NOT NULL DEFAULT '',
            phone_last4 VARCHAR(4) NOT NULL DEFAULT '',
            memo VARCHAR(255) NOT NULL DEFAULT '',
            status VARCHAR(32) NOT NULL DEFAULT 'active',
            occurrence_count INT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_series_key (series_key),
            KEY idx_series_dates (start_date, end_date),
            KEY idx_series_status (status)
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
    ensure_column($pdo, 'rhythmjoy_admin_reservations', 'series_id', 'BIGINT UNSIGNED NULL AFTER id');
    ensure_column($pdo, 'rhythmjoy_admin_reservations', 'occurrence_order', 'INT UNSIGNED NULL AFTER series_id');
    ensure_column($pdo, 'rhythmjoy_admin_reservations', 'rule_index', 'SMALLINT UNSIGNED NULL AFTER occurrence_order');
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_admin_sync_tasks (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            reservation_id BIGINT UNSIGNED NOT NULL,
            live_task_id BIGINT UNSIGNED NULL,
            action_type VARCHAR(40) NOT NULL,
            platform VARCHAR(32) NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending',
            result_text TEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY idx_reservation (reservation_id),
            KEY idx_live_task (live_task_id),
            KEY idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    ensure_column($pdo, 'rhythmjoy_admin_sync_tasks', 'live_task_id', 'BIGINT UNSIGNED NULL AFTER reservation_id');
    ensure_column($pdo, 'rhythmjoy_booking_ledger', 'gross_amount', 'INT UNSIGNED NULL AFTER price');
    ensure_column($pdo, 'rhythmjoy_booking_ledger', 'fee_amount', 'INT UNSIGNED NULL AFTER gross_amount');
    ensure_column($pdo, 'rhythmjoy_booking_ledger', 'net_amount', 'INT UNSIGNED NULL AFTER fee_amount');
    ensure_column($pdo, 'rhythmjoy_booking_ledger', 'amount_source', "VARCHAR(64) NOT NULL DEFAULT '' AFTER net_amount");
    ensure_column($pdo, 'rhythmjoy_booking_ledger', 'payment_method', "VARCHAR(64) NOT NULL DEFAULT '' AFTER amount_source");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_reflection_audits (
            audit_key VARCHAR(180) NOT NULL,
            ledger_id BIGINT UNSIGNED NULL,
            source_platform VARCHAR(32) NOT NULL DEFAULT '',
            target_platform VARCHAR(32) NOT NULL DEFAULT '',
            expected_task_type VARCHAR(32) NOT NULL DEFAULT '',
            current_status VARCHAR(32) NOT NULL DEFAULT '',
            audit_status VARCHAR(32) NOT NULL DEFAULT 'issue',
            severity VARCHAR(16) NOT NULL DEFAULT 'warning',
            reason VARCHAR(255) NOT NULL DEFAULT '',
            task_id BIGINT UNSIGNED NULL,
            task_status VARCHAR(32) NOT NULL DEFAULT '',
            reservation_date DATE NULL,
            room_key VARCHAR(8) NOT NULL DEFAULT '',
            start_time TIME NULL,
            end_time TIME NULL,
            reserver_name VARCHAR(128) NOT NULL DEFAULT '',
            reservation_number VARCHAR(64) NOT NULL DEFAULT '',
            checked_at DATETIME NOT NULL,
            first_seen_at DATETIME NOT NULL,
            resolved_at DATETIME NULL,
            detail_json TEXT NULL,
            PRIMARY KEY (audit_key),
            KEY idx_status (audit_status, severity),
            KEY idx_checked (checked_at),
            KEY idx_ledger (ledger_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_industry_comparison_snapshots (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            snapshot_key VARCHAR(120) NOT NULL,
            title VARCHAR(160) NOT NULL DEFAULT '',
            basis TEXT NULL,
            source_notes TEXT NULL,
            generated_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_snapshot_key (snapshot_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_industry_comparison_rows (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            snapshot_id BIGINT UNSIGNED NOT NULL,
            period_key VARCHAR(40) NOT NULL,
            period_label VARCHAR(80) NOT NULL,
            period_months DECIMAL(6,2) NOT NULL DEFAULT 1,
            studio_key VARCHAR(40) NOT NULL,
            studio_label VARCHAR(80) NOT NULL,
            group_key VARCHAR(40) NOT NULL,
            group_label VARCHAR(80) NOT NULL,
            room_labels VARCHAR(255) NOT NULL DEFAULT '',
            room_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
            events_count INT UNSIGNED NOT NULL DEFAULT 0,
            hours DECIMAL(10,2) NOT NULL DEFAULT 0,
            gross_amount INT UNSIGNED NOT NULL DEFAULT 0,
            avg_per_hour INT UNSIGNED NOT NULL DEFAULT 0,
            avg_per_event INT UNSIGNED NOT NULL DEFAULT 0,
            amount_basis VARCHAR(80) NOT NULL DEFAULT '',
            note VARCHAR(255) NOT NULL DEFAULT '',
            display_order SMALLINT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY idx_snapshot_period (snapshot_id, period_key),
            KEY idx_group (group_key, studio_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS rhythmjoy_price_policy_history (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            policy_key VARCHAR(120) NOT NULL,
            effective_date DATE NOT NULL,
            room_key VARCHAR(8) NOT NULL,
            room_label VARCHAR(20) NOT NULL DEFAULT '',
            dawn_hourly INT UNSIGNED NOT NULL DEFAULT 0,
            weekday_day INT UNSIGNED NOT NULL DEFAULT 0,
            after_hourly INT UNSIGNED NOT NULL DEFAULT 0,
            overnight INT UNSIGNED NOT NULL DEFAULT 0,
            naver_amount_same TINYINT(1) NOT NULL DEFAULT 1,
            spacecloud_amount_same TINYINT(1) NOT NULL DEFAULT 1,
            note VARCHAR(255) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uq_policy_key (policy_key),
            KEY idx_effective_room (effective_date, room_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    ensure_price_policy_history_seed($pdo);
}

function clean_date_value($value) {
    $value = trim((string) $value);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
        return '';
    }
    $parts = array_map('intval', explode('-', $value));
    if (count($parts) !== 3 || !checkdate($parts[1], $parts[2], $parts[0])) {
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

function normalize_recurring_rules($raw_rules) {
    if (!is_array($raw_rules) || count($raw_rules) < 1 || count($raw_rules) > 14) {
        throw new InvalidArgumentException('정기대관 요일 규칙은 1~14개까지 설정할 수 있습니다.');
    }
    $rules = array();
    $seen = array();
    foreach ($raw_rules as $index => $raw) {
        if (!is_array($raw)) {
            throw new InvalidArgumentException('정기대관 요일 규칙 형식이 올바르지 않습니다.');
        }
        $weekday = isset($raw['weekday']) ? intval($raw['weekday']) : 0;
        $room = clean_room_value(isset($raw['room']) ? $raw['room'] : '');
        $start = clean_hour_value(isset($raw['start']) ? $raw['start'] : '', false);
        $end = clean_hour_value(isset($raw['end']) ? $raw['end'] : '', true);
        if ($weekday < 1 || $weekday > 7 || $room === '' || $start < 0 || $end < 0 || $start >= $end) {
            throw new InvalidArgumentException('요일, 홀, 시작·종료 시간을 다시 확인해주세요.');
        }
        $signature = implode('|', array($weekday, $room, $start, $end));
        if (isset($seen[$signature])) {
            continue;
        }
        $seen[$signature] = true;
        $rules[] = array(
            'index' => count($rules),
            'weekday' => $weekday,
            'room' => $room,
            'start' => $start,
            'end' => $end,
        );
    }
    if (!$rules) {
        throw new InvalidArgumentException('사용할 수 있는 정기대관 규칙이 없습니다.');
    }
    return $rules;
}

function recurring_date_range($start_value, $end_value) {
    $start = clean_date_value($start_value);
    $end = clean_date_value($end_value);
    if ($start === '' || $end === '' || $start > $end) {
        throw new InvalidArgumentException('정기대관 시작일과 종료일을 확인해주세요.');
    }
    $start_date = new DateTime($start . ' 00:00:00');
    $end_date = new DateTime($end . ' 00:00:00');
    $days = intval($start_date->diff($end_date)->format('%a')) + 1;
    if ($days > 366) {
        throw new InvalidArgumentException('정기대관은 최대 1년(366일)까지 한 번에 등록할 수 있습니다.');
    }
    return array($start, $end, $start_date, $end_date);
}

function date_is_fifth_weekday($date_text) {
    return intval(substr((string) $date_text, 8, 2)) >= 29;
}

function generate_recurring_occurrences($start_value, $end_value, $raw_rules, $fifth_week_policy) {
    list($start, $end, $cursor, $end_date) = recurring_date_range($start_value, $end_value);
    $rules = normalize_recurring_rules($raw_rules);
    $policy = $fifth_week_policy === 'exclude' ? 'exclude' : 'include';
    $occurrences = array();
    while ($cursor <= $end_date) {
        $date_text = $cursor->format('Y-m-d');
        $weekday = intval($cursor->format('N'));
        foreach ($rules as $rule) {
            if ($rule['weekday'] !== $weekday) {
                continue;
            }
            $fifth = date_is_fifth_weekday($date_text);
            $included = !($policy === 'exclude' && $fifth);
            $occurrences[] = array(
                'key' => 'r' . $rule['index'] . ':' . $date_text,
                'originalDate' => $date_text,
                'date' => $date_text,
                'weekday' => $weekday,
                'ruleIndex' => $rule['index'],
                'room' => $rule['room'],
                'start' => $rule['start'],
                'end' => $rule['end'],
                'included' => $included,
                'fifthWeek' => $fifth,
                'excludedReason' => $included ? '' : 'fifth_week',
                'modified' => false,
            );
            if (count($occurrences) > 500) {
                throw new InvalidArgumentException('생성 일정이 500건을 넘습니다. 기간 또는 규칙을 나눠주세요.');
            }
        }
        $cursor->modify('+1 day');
    }
    return array($rules, $occurrences, $start, $end, $policy);
}

function normalize_recurring_occurrences($raw_occurrences) {
    if (!is_array($raw_occurrences) || count($raw_occurrences) < 1 || count($raw_occurrences) > 500) {
        throw new InvalidArgumentException('정기대관 일정은 1~500건까지 처리할 수 있습니다.');
    }
    $rows = array();
    $seen = array();
    foreach ($raw_occurrences as $index => $raw) {
        if (!is_array($raw)) {
            throw new InvalidArgumentException('정기대관 일정 형식이 올바르지 않습니다.');
        }
        $date = clean_date_value(isset($raw['date']) ? $raw['date'] : '');
        $original_date = clean_date_value(isset($raw['originalDate']) ? $raw['originalDate'] : $date);
        $room = clean_room_value(isset($raw['room']) ? $raw['room'] : '');
        $start = clean_hour_value(isset($raw['start']) ? $raw['start'] : '', false);
        $end = clean_hour_value(isset($raw['end']) ? $raw['end'] : '', true);
        if ($date === '' || $original_date === '' || $room === '' || $start < 0 || $end < 0 || $start >= $end) {
            throw new InvalidArgumentException('날짜별 홀과 시간을 다시 확인해주세요.');
        }
        $key = isset($raw['key']) && trim((string) $raw['key']) !== ''
            ? substr(trim((string) $raw['key']), 0, 80)
            : 'o' . $index . ':' . $original_date;
        if (isset($seen[$key])) {
            throw new InvalidArgumentException('중복된 정기대관 일정 키가 있습니다.');
        }
        $seen[$key] = true;
        $included = !isset($raw['included']) || filter_var($raw['included'], FILTER_VALIDATE_BOOLEAN);
        $rows[] = array(
            'key' => $key,
            'originalDate' => $original_date,
            'date' => $date,
            'weekday' => intval(date('N', strtotime($date))),
            'ruleIndex' => isset($raw['ruleIndex']) ? max(0, intval($raw['ruleIndex'])) : 0,
            'room' => $room,
            'start' => $start,
            'end' => $end,
            'included' => $included,
            'fifthWeek' => date_is_fifth_weekday($date),
            'excludedReason' => $included ? '' : (isset($raw['excludedReason']) ? substr((string) $raw['excludedReason'], 0, 32) : 'manual'),
            'modified' => !empty($raw['modified']) || $date !== $original_date,
        );
    }
    return $rows;
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
               DATE_FORMAT(last_checked_at, '%Y-%m-%dT%H:%i:%s+09:00') AS last_checked_at,
               DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
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
        SELECT t.reservation_id, t.platform, COALESCE(l.status, t.status) AS status
        FROM rhythmjoy_admin_sync_tasks t
        LEFT JOIN rhythmjoy_spacecloud_tasks l ON l.id = t.live_task_id
        WHERE t.status <> 'canceled'
        ORDER BY t.id ASC
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
               payment_status, price, gross_amount, fee_amount, net_amount, amount_source, payment_method,
               reservation_date,
               TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(end_time, '%H:%i') AS end_time_text,
               DATE_FORMAT(last_event_at, '%Y-%m-%dT%H:%i:%s+09:00') AS last_event_at,
               DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at,
               DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date = ?
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
        ORDER BY room_key ASC, start_time ASC, id ASC
    ");
    $stmt->execute(array($date));
    $rows = array();
    foreach ($stmt->fetchAll() as $row) {
        $source = $row['source_platform'] ?: 'ledger';
        $room = strtoupper($row['room_key']);
        $start_hour = hour_from_time_value($row['start_time_text'], false);
        $end_hour = hour_from_time_value($row['end_time_text'], true);
        if ($end_hour <= $start_hour) {
            $end_hour = 24;
        }
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
            'paymentStatus' => $row['payment_status'],
            'price' => $row['price'],
            'grossAmount' => ledger_gross_amount($row),
            'netAmount' => ledger_net_amount($row),
            'feeAmount' => ledger_fee_amount($row),
            'amountSource' => $row['amount_source'],
            'paymentMethod' => $row['payment_method'],
            'createdAt' => $row['created_at'] ?: $row['last_event_at'],
            'updatedAt' => $row['updated_at'] ?: $row['last_event_at'],
        );
    }
    return $rows;
}

function admin_reservation_rows($pdo, $date) {
    $task_summary = task_summary_rows($pdo);
    $stmt = $pdo->prepare("
        SELECT id, series_id, reservation_key, reservation_date, room_key, start_hour, end_hour,
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
            'seriesId' => $row['series_id'] !== null ? intval($row['series_id']) : null,
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
            'paymentStatus' => '',
            'price' => '',
            'grossAmount' => 0,
            'netAmount' => 0,
            'feeAmount' => 0,
            'amountSource' => '',
            'paymentMethod' => '',
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

function recurring_conflict_row($source, $row) {
    $is_admin = $source === 'admin';
    return array(
        'source' => $source,
        'sourceLabel' => $is_admin ? '관리자 일정' : ($row['source_platform'] === 'naver' ? '네이버' : '스페이스클라우드'),
        'id' => intval($row['id']),
        'name' => (string) $row['reserver_name'],
        'date' => (string) $row['reservation_date'],
        'room' => strtoupper((string) $row['room_key']),
        'start' => $is_admin ? intval($row['start_hour']) : hour_from_time_value($row['start_time_text'], false),
        'end' => $is_admin ? intval($row['end_hour']) : hour_from_time_value($row['end_time_text'], true),
    );
}

function recurring_preview_payload($pdo, $payload) {
    if (isset($payload['occurrences'])) {
        $occurrences = normalize_recurring_occurrences($payload['occurrences']);
        $rules = isset($payload['rules']) ? normalize_recurring_rules($payload['rules']) : array();
        $dates = array_map(function($row) { return $row['date']; }, $occurrences);
        $start = min($dates);
        $end = max($dates);
        recurring_date_range($start, $end);
        $policy = isset($payload['fifthWeekPolicy']) && $payload['fifthWeekPolicy'] === 'exclude' ? 'exclude' : 'include';
    } else {
        list($rules, $occurrences, $start, $end, $policy) = generate_recurring_occurrences(
            isset($payload['startDate']) ? $payload['startDate'] : '',
            isset($payload['endDate']) ? $payload['endDate'] : '',
            isset($payload['rules']) ? $payload['rules'] : array(),
            isset($payload['fifthWeekPolicy']) ? $payload['fifthWeekPolicy'] : 'include'
        );
    }

    $ledger_rows = array();
    $admin_rows = array();
    $included_dates = array_values(array_map(function($row) { return $row['date']; }, array_filter($occurrences, function($row) {
        return $row['included'];
    })));
    if ($included_dates) {
        $range_start = min($included_dates);
        $range_end = max($included_dates);
        $stmt = $pdo->prepare("
            SELECT id, source_platform, reservation_date, room_key, reserver_name,
                   TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
                   TIME_FORMAT(end_time, '%H:%i') AS end_time_text
            FROM rhythmjoy_booking_ledger
            WHERE reservation_date BETWEEN ? AND ?
              AND current_status <> 'canceled'
              AND COALESCE(source_mode, '') <> 'admin-task-anchor'
              AND source_platform <> 'google-backfill'
        ");
        $stmt->execute(array($range_start, $range_end));
        $ledger_rows = $stmt->fetchAll();

        $stmt = $pdo->prepare("
            SELECT id, reservation_date, room_key, start_hour, end_hour, reserver_name
            FROM rhythmjoy_admin_reservations
            WHERE reservation_date BETWEEN ? AND ?
              AND status <> 'canceled'
        ");
        $stmt->execute(array($range_start, $range_end));
        $admin_rows = $stmt->fetchAll();
    }

    foreach ($occurrences as $index => &$occurrence) {
        $occurrence['conflicts'] = array();
        if (!$occurrence['included']) {
            $occurrence['status'] = 'excluded';
            continue;
        }
        foreach ($ledger_rows as $row) {
            if ($row['reservation_date'] !== $occurrence['date'] || strtoupper($row['room_key']) !== $occurrence['room']) {
                continue;
            }
            $existing_start = hour_from_time_value($row['start_time_text'], false);
            $existing_end = hour_from_time_value($row['end_time_text'], true);
            if ($occurrence['start'] < $existing_end && $occurrence['end'] > $existing_start) {
                $occurrence['conflicts'][] = recurring_conflict_row('ledger', $row);
            }
        }
        foreach ($admin_rows as $row) {
            if ($row['reservation_date'] !== $occurrence['date'] || strtoupper($row['room_key']) !== $occurrence['room']) {
                continue;
            }
            if ($occurrence['start'] < intval($row['end_hour']) && $occurrence['end'] > intval($row['start_hour'])) {
                $occurrence['conflicts'][] = recurring_conflict_row('admin', $row);
            }
        }
        foreach ($occurrences as $other_index => $other) {
            if ($other_index === $index || !$other['included']) {
                continue;
            }
            if ($other['date'] === $occurrence['date'] && $other['room'] === $occurrence['room']
                && $occurrence['start'] < $other['end'] && $occurrence['end'] > $other['start']) {
                $occurrence['conflicts'][] = array(
                    'source' => 'preview',
                    'sourceLabel' => '이번 정기대관',
                    'id' => $other['key'],
                    'name' => '',
                    'date' => $other['date'],
                    'room' => $other['room'],
                    'start' => $other['start'],
                    'end' => $other['end'],
                );
            }
        }
        $occurrence['status'] = $occurrence['conflicts'] ? 'conflict' : ($occurrence['modified'] ? 'modified' : 'ready');
    }
    unset($occurrence);

    $summary = array('total' => count($occurrences), 'included' => 0, 'excluded' => 0, 'conflicts' => 0, 'modified' => 0);
    foreach ($occurrences as $row) {
        if (!$row['included']) {
            $summary['excluded'] += 1;
        } else {
            $summary['included'] += 1;
        }
        if ($row['status'] === 'conflict') $summary['conflicts'] += 1;
        if ($row['modified']) $summary['modified'] += 1;
    }
    $preview_hash = hash('sha256', json_encode($occurrences, JSON_UNESCAPED_UNICODE));
    return array(
        'ok' => true,
        'startDate' => $start,
        'endDate' => $end,
        'fifthWeekPolicy' => $policy,
        'rules' => $rules,
        'occurrences' => $occurrences,
        'summary' => $summary,
        'previewHash' => $preview_hash,
    );
}

function admin_series_rows($pdo) {
    $stmt = $pdo->query("
        SELECT s.id, s.series_key, s.title, s.start_date, s.end_date,
               s.fifth_week_policy, s.reserver_name, s.memo, s.status, s.occurrence_count,
               SUM(CASE WHEN r.status <> 'canceled' THEN 1 ELSE 0 END) AS visible_count,
               SUM(CASE WHEN r.status = 'canceling' THEN 1 ELSE 0 END) AS canceling_count,
               SUM(CASE WHEN r.status = 'canceled' THEN 1 ELSE 0 END) AS canceled_count,
               DATE_FORMAT(s.created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at,
               DATE_FORMAT(s.updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_admin_series s
        LEFT JOIN rhythmjoy_admin_reservations r ON r.series_id = s.id
        GROUP BY s.id
        ORDER BY s.updated_at DESC, s.id DESC
        LIMIT 30
    ");
    $rows = array();
    foreach ($stmt->fetchAll() as $row) {
        $rows[] = array(
            'id' => intval($row['id']),
            'key' => $row['series_key'],
            'title' => $row['title'],
            'startDate' => $row['start_date'],
            'endDate' => $row['end_date'],
            'fifthWeekPolicy' => $row['fifth_week_policy'],
            'name' => $row['reserver_name'],
            'memo' => $row['memo'],
            'status' => $row['status'],
            'occurrenceCount' => intval($row['occurrence_count']),
            'visibleCount' => intval($row['visible_count']),
            'cancelingCount' => intval($row['canceling_count']),
            'canceledCount' => intval($row['canceled_count']),
            'createdAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
        );
    }
    return $rows;
}

function admin_series_occurrence_rows($pdo, $series_id) {
    $stmt = $pdo->prepare("
        SELECT id, series_id, occurrence_order, rule_index, reservation_date, room_key,
               start_hour, end_hour, reserver_name, memo, status,
               DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_admin_reservations
        WHERE series_id = ?
        ORDER BY reservation_date ASC, start_hour ASC, id ASC
    ");
    $stmt->execute(array($series_id));
    $rows = array();
    foreach ($stmt->fetchAll() as $row) {
        $rows[] = array(
            'id' => intval($row['id']),
            'seriesId' => intval($row['series_id']),
            'order' => intval($row['occurrence_order']),
            'ruleIndex' => intval($row['rule_index']),
            'date' => $row['reservation_date'],
            'room' => strtoupper($row['room_key']),
            'start' => intval($row['start_hour']),
            'end' => intval($row['end_hour']),
            'name' => $row['reserver_name'],
            'memo' => $row['memo'],
            'status' => $row['status'],
            'updatedAt' => $row['updated_at'],
        );
    }
    return $rows;
}

function empty_month_day_summary($date) {
    $rooms = array();
    foreach (array('A', 'B', 'C', 'D', 'E') as $room) {
        $rooms[$room] = 0;
    }
    return array(
        'date' => $date,
        'day' => intval(substr($date, -2)),
        'count' => 0,
        'revenue' => 0,
        'netRevenue' => 0,
        'feeRevenue' => 0,
        'missingCount' => 0,
        'rooms' => $rooms,
    );
}

function add_month_day_summary(&$day, $room, $row) {
    $room = strtoupper(substr(trim((string) $room), 0, 1));
    $day['count'] += 1;
    if (isset($day['rooms'][$room])) {
        $day['rooms'][$room] += 1;
    }
    $amount = ledger_gross_amount($row);
    if ($amount > 0) {
        $day['revenue'] += $amount;
    } else {
        $day['missingCount'] += 1;
    }
    $day['netRevenue'] += ledger_net_amount($row);
    $day['feeRevenue'] += ledger_fee_amount($row);
}

function month_summary($pdo, $date) {
    $month = substr($date, 0, 7);
    $month_start = $month . '-01';
    $month_end = date('Y-m-t', strtotime($month_start));
    $days = array();
    $day_count = intval(date('t', strtotime($month_start)));

    for ($day = 1; $day <= $day_count; $day += 1) {
        $key = sprintf('%s-%02d', $month, $day);
        $days[$key] = empty_month_day_summary($key);
    }

    $ledger = $pdo->prepare("
        SELECT reservation_date, room_key, price, gross_amount, fee_amount, net_amount
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date BETWEEN ? AND ?
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
        ORDER BY reservation_date ASC, room_key ASC, start_time ASC, id ASC
    ");
    $ledger->execute(array($month_start, $month_end));
    foreach ($ledger->fetchAll() as $row) {
        $key = $row['reservation_date'];
        if (!isset($days[$key])) {
            $days[$key] = empty_month_day_summary($key);
        }
        add_month_day_summary($days[$key], $row['room_key'], $row);
    }

    $admin = $pdo->prepare("
        SELECT reservation_date, room_key
        FROM rhythmjoy_admin_reservations
        WHERE reservation_date BETWEEN ? AND ?
          AND status <> 'canceled'
        ORDER BY reservation_date ASC, room_key ASC, start_hour ASC, id ASC
    ");
    $admin->execute(array($month_start, $month_end));
    foreach ($admin->fetchAll() as $row) {
        $key = $row['reservation_date'];
        if (!isset($days[$key])) {
            $days[$key] = empty_month_day_summary($key);
        }
        add_month_day_summary($days[$key], $row['room_key'], array('price' => ''));
    }

    $total_count = 0;
    $total_revenue = 0;
    $total_net_revenue = 0;
    $total_fee_revenue = 0;
    $missing_count = 0;
    foreach ($days as $day) {
        $total_count += intval($day['count']);
        $total_revenue += intval($day['revenue']);
        $total_net_revenue += intval($day['netRevenue']);
        $total_fee_revenue += intval($day['feeRevenue']);
        $missing_count += intval($day['missingCount']);
    }

    return array(
        'month' => $month,
        'startDate' => $month_start,
        'endDate' => $month_end,
        'count' => $total_count,
        'revenue' => $total_revenue,
        'netRevenue' => $total_net_revenue,
        'feeRevenue' => $total_fee_revenue,
        'missingCount' => $missing_count,
        'days' => array_values($days),
    );
}

function parse_price_amount($value) {
    $digits = preg_replace('/\D+/', '', (string) $value);
    return $digits === '' ? 0 : intval($digits);
}

function ledger_gross_amount($row) {
    $gross = isset($row['gross_amount']) ? intval($row['gross_amount']) : 0;
    return $gross > 0 ? $gross : parse_price_amount(isset($row['price']) ? $row['price'] : '');
}

function ledger_net_amount($row) {
    return isset($row['net_amount']) ? intval($row['net_amount']) : 0;
}

function ledger_fee_amount($row) {
    return isset($row['fee_amount']) ? intval($row['fee_amount']) : 0;
}

function time_text_to_minutes($value, $is_end) {
    $value = (string) $value;
    if (!preg_match('/^(\d{2}):(\d{2})/', $value, $matches)) {
        return $is_end ? 24 * 60 : 0;
    }
    $hour = intval($matches[1]);
    $minute = intval($matches[2]);
    if ($is_end && $hour === 0 && $minute === 0) {
        return 24 * 60;
    }
    return $hour * 60 + $minute;
}

function booking_time_range_minutes($start_value, $end_value) {
    $start = time_text_to_minutes($start_value, false);
    $end = time_text_to_minutes($end_value, true);
    if ($end <= $start) {
        $end += 24 * 60;
    }
    return array($start, $end);
}

function room_label($room_key) {
    return strtoupper((string) $room_key) . '홀';
}

function year_days($year) {
    return intval(date('L', strtotime($year . '-01-01'))) === 1 ? 366 : 365;
}

function empty_year_revenue($year) {
    $capacity = year_days($year) * 24;
    return array(
        'year' => intval($year),
        'total' => 0,
        'netTotal' => 0,
        'feeTotal' => 0,
        'confirmedCount' => 0,
        'missingCount' => 0,
        'hours' => 0,
        'capacityHours' => $capacity * 5,
        'bookingAverage' => 0,
        'hourAverage' => 0,
        'occupancyRate' => 0,
    );
}

function empty_room_year_revenue($year, $room_key) {
    return array(
        'year' => intval($year),
        'room' => strtolower($room_key),
        'roomLabel' => room_label($room_key),
        'total' => 0,
        'netTotal' => 0,
        'feeTotal' => 0,
        'confirmedCount' => 0,
        'missingCount' => 0,
        'hours' => 0,
        'capacityHours' => year_days($year) * 24,
        'bookingAverage' => 0,
        'hourAverage' => 0,
        'occupancyRate' => 0,
    );
}

function finalize_revenue_bucket($row) {
    $hours = floatval($row['hours']);
    $total = intval($row['total']);
    $count = intval($row['confirmedCount']);
    $priced_count = max(1, $count - intval($row['missingCount']));
    $capacity = max(1, floatval($row['capacityHours']));
    $row['hours'] = round($hours, 2);
    $row['bookingAverage'] = intval(round($total / $priced_count));
    $row['hourAverage'] = $hours > 0 ? intval(round($total / $hours)) : 0;
    $row['occupancyRate'] = round(($hours / $capacity) * 100, 2);
    return $row;
}

function price_policy_seed_rows() {
    return array(
        array('2025-base-a', '2025-01-01', 'a', 'A홀', 0, 10000, 12000, 30000, '2025년 가격표 기준. 새벽 시간당 가격은 당시 별도 표기 없음'),
        array('2025-base-b', '2025-01-01', 'b', 'B홀', 0, 8000, 10000, 20000, '2025년 가격표 기준. 새벽 시간당 가격은 당시 별도 표기 없음'),
        array('2025-base-c', '2025-01-01', 'c', 'C홀', 0, 4000, 6000, 15000, '2025년 가격표 기준. 새벽 시간당 가격은 당시 별도 표기 없음'),
        array('2025-base-d', '2025-01-01', 'd', 'D홀', 0, 3000, 5000, 15000, '2025년 가격표 기준. 새벽 시간당 가격은 당시 별도 표기 없음'),
        array('2025-base-e', '2025-01-01', 'e', 'E홀', 0, 8000, 10000, 20000, '2025년 가격표 기준. 새벽 시간당 가격은 당시 별도 표기 없음'),
        array('2026-current-a', '2026-01-01', 'a', 'A홀', 7000, 13000, 20000, 30000, '2026년 기본가. 플랫폼별 실제 결제/수수료는 원장 금액 기준'),
        array('2026-current-b', '2026-01-01', 'b', 'B홀', 5000, 10000, 12000, 20000, '2026년 기본가. 2026-07-16 이전 평일 낮 10,000원'),
        array('2026-current-c', '2026-01-01', 'c', 'C홀', 4000, 4000, 6000, 15000, '2026년 기본가'),
        array('2026-current-d', '2026-01-01', 'd', 'D홀', 3000, 3000, 5000, 15000, '2026년 기본가'),
        array('2026-current-e', '2026-01-01', 'e', 'E홀', 5000, 10000, 12000, 20000, '2026년 기본가. 2026-07-16 이전 평일 낮 10,000원'),
        array('2026-07-16-be-a', '2026-07-16', 'a', 'A홀', 7000, 13000, 20000, 30000, '스페이스클라우드 가격을 네이버와 동일하게 정렬'),
        array('2026-07-16-be-b', '2026-07-16', 'b', 'B홀', 5000, 8000, 12000, 20000, 'B홀 평일 낮 8,000원 테스트 시작'),
        array('2026-07-16-be-c', '2026-07-16', 'c', 'C홀', 4000, 4000, 6000, 15000, '스페이스클라우드 가격을 네이버와 동일하게 정렬'),
        array('2026-07-16-be-d', '2026-07-16', 'd', 'D홀', 3000, 3000, 5000, 15000, '스페이스클라우드 가격을 네이버와 동일하게 정렬'),
        array('2026-07-16-be-e', '2026-07-16', 'e', 'E홀', 5000, 8000, 12000, 20000, 'E홀 평일 낮 8,000원 테스트 시작'),
    );
}

function ensure_price_policy_history_seed($pdo) {
    $stmt = $pdo->prepare("
        INSERT INTO rhythmjoy_price_policy_history (
            policy_key, effective_date, room_key, room_label,
            dawn_hourly, weekday_day, after_hourly, overnight,
            naver_amount_same, spacecloud_amount_same, note, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NOW())
        ON DUPLICATE KEY UPDATE
            effective_date = VALUES(effective_date),
            room_key = VALUES(room_key),
            room_label = VALUES(room_label),
            dawn_hourly = VALUES(dawn_hourly),
            weekday_day = VALUES(weekday_day),
            after_hourly = VALUES(after_hourly),
            overnight = VALUES(overnight),
            naver_amount_same = VALUES(naver_amount_same),
            spacecloud_amount_same = VALUES(spacecloud_amount_same),
            note = VALUES(note)
    ");
    foreach (price_policy_seed_rows() as $row) {
        $stmt->execute($row);
    }
}

function price_policy_history_rows($pdo) {
    $stmt = $pdo->query("
        SELECT policy_key, effective_date, room_key, room_label,
               dawn_hourly, weekday_day, after_hourly, overnight,
               naver_amount_same, spacecloud_amount_same, note
        FROM rhythmjoy_price_policy_history
        ORDER BY effective_date ASC, FIELD(room_key, 'a', 'b', 'c', 'd', 'e'), id ASC
    ");
    $rows = array();
    $previous_by_room = array();
    foreach ($stmt->fetchAll() as $row) {
        $room = strtolower((string) $row['room_key']);
        $current = array(
            'key' => $row['policy_key'],
            'effectiveDate' => $row['effective_date'],
            'room' => $room,
            'roomLabel' => $row['room_label'] ?: room_label($row['room_key']),
            'dawnHourly' => intval($row['dawn_hourly']),
            'weekdayDay' => intval($row['weekday_day']),
            'afterHourly' => intval($row['after_hourly']),
            'overnight' => intval($row['overnight']),
            'naverAmountSame' => intval($row['naver_amount_same']) === 1,
            'spacecloudAmountSame' => intval($row['spacecloud_amount_same']) === 1,
            'note' => $row['note'],
        );
        $previous = isset($previous_by_room[$room]) ? $previous_by_room[$room] : null;
        $current['previous'] = $previous;
        $current['changes'] = array();
        foreach (array('dawnHourly', 'weekdayDay', 'afterHourly', 'overnight') as $field) {
            $before = $previous ? intval($previous[$field]) : null;
            $after = intval($current[$field]);
            $current['changes'][$field] = array(
                'before' => $before,
                'after' => $after,
                'diff' => $before === null ? 0 : $after - $before,
                'changed' => $before !== null && $before !== $after,
            );
        }
        $current['hasPrevious'] = $previous !== null;
        $current['hasChangedPrice'] = false;
        foreach ($current['changes'] as $change) {
            if ($change['changed']) {
                $current['hasChangedPrice'] = true;
                break;
            }
        }
        $previous_by_room[$room] = array(
            'effectiveDate' => $current['effectiveDate'],
            'dawnHourly' => $current['dawnHourly'],
            'weekdayDay' => $current['weekdayDay'],
            'afterHourly' => $current['afterHourly'],
            'overnight' => $current['overnight'],
        );
        $rows[] = $current;
    }
    return $rows;
}

function price_policy_rows() {
    $old = array(
        'a' => array('before16' => 10000, 'after16' => 12000, 'overnight' => 30000),
        'b' => array('before16' => 8000, 'after16' => 10000, 'overnight' => 20000),
        'c' => array('before16' => 4000, 'after16' => 6000, 'overnight' => 15000),
        'd' => array('before16' => 3000, 'after16' => 5000, 'overnight' => 15000),
        'e' => array('before16' => 8000, 'after16' => 10000, 'overnight' => 20000),
    );
    $current = array(
        'a' => array('before16' => 13000, 'after16' => 20000, 'overnight' => 30000),
        'b' => array('before16' => 8000, 'after16' => 12000, 'overnight' => 20000),
        'c' => array('before16' => 4000, 'after16' => 6000, 'overnight' => 15000),
        'd' => array('before16' => 3000, 'after16' => 5000, 'overnight' => 15000),
        'e' => array('before16' => 8000, 'after16' => 12000, 'overnight' => 20000),
    );
    $rows = array();
    foreach (array('a', 'b', 'c', 'd', 'e') as $room) {
        $items = array();
        foreach (array('before16', 'after16', 'overnight') as $key) {
            $before = intval($old[$room][$key]);
            $after = intval($current[$room][$key]);
            $items[$key] = array(
                'before' => $before,
                'after' => $after,
                'diff' => $after - $before,
                'rate' => $before > 0 ? round((($after - $before) / $before) * 100, 1) : 0,
            );
        }
        $rows[] = array(
            'room' => $room,
            'roomLabel' => room_label($room),
            'prices' => $items,
        );
    }
    return $rows;
}

function empty_period_bucket($key, $label) {
    return array(
        'key' => $key,
        'label' => $label,
        'total' => 0,
        'netTotal' => 0,
        'feeTotal' => 0,
        'confirmedCount' => 0,
        'missingCount' => 0,
        'hours' => 0,
        'bookingAverage' => 0,
        'hourAverage' => 0,
    );
}

function finalize_period_bucket($row) {
    $hours = floatval($row['hours']);
    $total = intval($row['total']);
    $priced_count = max(1, intval($row['confirmedCount']) - intval($row['missingCount']));
    $row['total'] = $total;
    $row['confirmedCount'] = intval($row['confirmedCount']);
    $row['missingCount'] = intval($row['missingCount']);
    $row['hours'] = round($hours, 2);
    $row['bookingAverage'] = intval(round($total / $priced_count));
    $row['hourAverage'] = $hours > 0 ? intval(round($total / $hours)) : 0;
    return $row;
}

function percent_change($base, $next) {
    $base = floatval($base);
    $next = floatval($next);
    if (abs($base) < 0.00001) {
        return abs($next) < 0.00001 ? 0 : 100;
    }
    return round((($next - $base) / $base) * 100, 1);
}

function period_day_count($start_date, $end_date) {
    $start = strtotime($start_date);
    $end = strtotime($end_date);
    if (!$start || !$end || $end < $start) {
        return 0;
    }
    return intval(floor(($end - $start) / 86400)) + 1;
}

function weekday_count_between($start_date, $end_date) {
    $start = strtotime($start_date);
    $end = strtotime($end_date);
    if (!$start || !$end || $end < $start) {
        return 0;
    }
    $count = 0;
    for ($ts = $start; $ts <= $end; $ts += 86400) {
        $weekday = intval(date('w', $ts));
        if ($weekday >= 1 && $weekday <= 5) {
            $count += 1;
        }
    }
    return $count;
}

function overlap_minutes($start_a, $end_a, $start_b, $end_b) {
    return max(0, min($end_a, $end_b) - max($start_a, $start_b));
}

function collect_be_weekday_day_metrics($pdo, $start_date, $end_date) {
    $bucket = array(
        'startDate' => $start_date,
        'endDate' => $end_date,
        'weekdayDays' => weekday_count_between($start_date, $end_date),
        'count' => 0,
        'hours' => 0,
        'gross' => 0,
        'net' => 0,
        'fee' => 0,
        'missingCount' => 0,
        'rooms' => array(
            'b' => array('room' => 'b', 'roomLabel' => 'B홀', 'count' => 0, 'hours' => 0, 'gross' => 0),
            'e' => array('room' => 'e', 'roomLabel' => 'E홀', 'count' => 0, 'hours' => 0, 'gross' => 0),
        ),
    );

    $stmt = $pdo->prepare("
        SELECT room_key,
               TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(end_time, '%H:%i') AS end_time_text,
               price, gross_amount, fee_amount, net_amount
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date BETWEEN ? AND ?
          AND room_key IN ('b', 'e', 'B', 'E')
          AND DAYOFWEEK(reservation_date) BETWEEN 2 AND 6
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
        ORDER BY reservation_date ASC, start_time ASC, id ASC
    ");
    $stmt->execute(array($start_date, $end_date));
    foreach ($stmt->fetchAll() as $row) {
        $room = strtolower((string) $row['room_key']);
        if (!isset($bucket['rooms'][$room])) {
            continue;
        }
        list($start, $end) = booking_time_range_minutes($row['start_time_text'], $row['end_time_text']);
        $total_minutes = max(1, $end - $start);
        $minutes = overlap_minutes($start, $end, 6 * 60, 16 * 60);
        if ($minutes <= 0) {
            continue;
        }
        $portion = $minutes / $total_minutes;
        $gross = ledger_gross_amount($row);
        $net = ledger_net_amount($row);
        $fee = ledger_fee_amount($row);
        $gross_part = intval(round($gross * $portion));
        $net_part = intval(round($net * $portion));
        $fee_part = intval(round($fee * $portion));
        $hours = round($minutes / 60, 4);

        $bucket['count'] += 1;
        $bucket['hours'] += $hours;
        $bucket['gross'] += $gross_part;
        $bucket['net'] += $net_part;
        $bucket['fee'] += $fee_part;
        if ($gross <= 0) {
            $bucket['missingCount'] += 1;
        }
        $bucket['rooms'][$room]['count'] += 1;
        $bucket['rooms'][$room]['hours'] += $hours;
        $bucket['rooms'][$room]['gross'] += $gross_part;
    }

    $bucket['hours'] = round($bucket['hours'], 2);
    $bucket['hourAverage'] = $bucket['hours'] > 0 ? intval(round($bucket['gross'] / $bucket['hours'])) : 0;
    $bucket['dayAverage'] = intval(round($bucket['gross'] / max(1, $bucket['weekdayDays'])));
    foreach ($bucket['rooms'] as $room => $row) {
        $row['hours'] = round(floatval($row['hours']), 2);
        $row['hourAverage'] = $row['hours'] > 0 ? intval(round(intval($row['gross']) / $row['hours'])) : 0;
        $bucket['rooms'][$room] = $row;
    }
    $bucket['rooms'] = array_values($bucket['rooms']);
    return $bucket;
}

function be_weekday_day_experiment($pdo) {
    $start = '2026-07-16';
    $today = date('Y-m-d');
    $after_end = $today < $start ? $start : $today;
    $after_max = date('Y-m-d', strtotime($start . ' +27 days'));
    if ($after_end > $after_max) {
        $after_end = $after_max;
    }
    $days = max(1, period_day_count($start, $after_end));
    $before_start = date('Y-m-d', strtotime($start . ' -' . $days . ' days'));
    $before_end = date('Y-m-d', strtotime($start . ' -1 day'));
    $last_year_start = date('Y-m-d', strtotime($start . ' -1 year'));
    $last_year_end = date('Y-m-d', strtotime($after_end . ' -1 year'));

    $before = collect_be_weekday_day_metrics($pdo, $before_start, $before_end);
    $after = collect_be_weekday_day_metrics($pdo, $start, $after_end);
    $last_year = collect_be_weekday_day_metrics($pdo, $last_year_start, $last_year_end);
    $required_rate = 25.0;
    $before_daily_hours = floatval($before['hours']) / max(1, intval($before['weekdayDays']));
    $required_after_hours = $before_daily_hours * 1.25 * max(1, intval($after['weekdayDays']));
    $after_hours = floatval($after['hours']);
    $progress = $required_after_hours > 0 ? round(($after_hours / $required_after_hours) * 100, 1) : 0;
    $gross_diff = intval($after['gross']) - intval(round(intval($before['gross']) / max(1, intval($before['weekdayDays'])) * max(1, intval($after['weekdayDays']))));

    return array(
        'key' => 'be-weekday-day-8000',
        'label' => 'B/E 평일 낮 8,000원 성과 추적',
        'policyStartDate' => $start,
        'basis' => 'B/E홀 평일 06-16시 겹치는 예약시간만 비례 계산합니다. 10,000원에서 8,000원으로 낮추면 같은 매출을 유지하려면 대관시간이 약 25% 늘어야 합니다.',
        'requiredHoursIncreaseRate' => $required_rate,
        'before' => $before,
        'after' => $after,
        'lastYearSame' => $last_year,
        'breakEven' => array(
            'requiredHours' => round($required_after_hours, 2),
            'actualHours' => round($after_hours, 2),
            'progressRate' => $progress,
            'grossDiffVsBeforePace' => $gross_diff,
            'verdict' => $after_hours >= $required_after_hours ? '손익분기 이상' : '추적 중',
        ),
    );
}

function collect_period_revenue($pdo, $start_date, $end_date) {
    $rooms = array('a', 'b', 'c', 'd', 'e');
    $buckets = array(
        'all' => empty_period_bucket('all', '전체'),
    );
    foreach ($rooms as $room) {
        $buckets[$room] = empty_period_bucket($room, room_label($room));
    }

    $stmt = $pdo->prepare("
        SELECT room_key,
               TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(end_time, '%H:%i') AS end_time_text,
               price, gross_amount, fee_amount, net_amount
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date BETWEEN ? AND ?
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
        ORDER BY reservation_date ASC, start_time ASC, id ASC
    ");
    $stmt->execute(array($start_date, $end_date));
    foreach ($stmt->fetchAll() as $row) {
        $room = strtolower((string) $row['room_key']);
        if (!isset($buckets[$room])) {
            continue;
        }
        $amount = ledger_gross_amount($row);
        $net_amount = ledger_net_amount($row);
        $fee_amount = ledger_fee_amount($row);
        list($start, $end) = booking_time_range_minutes($row['start_time_text'], $row['end_time_text']);
        $hours = max(0, ($end - $start) / 60);
        foreach (array('all', $room) as $key) {
            $buckets[$key]['confirmedCount'] += 1;
            $buckets[$key]['hours'] += $hours;
            $buckets[$key]['netTotal'] += $net_amount;
            $buckets[$key]['feeTotal'] += $fee_amount;
            if ($amount > 0) {
                $buckets[$key]['total'] += $amount;
            } else {
                $buckets[$key]['missingCount'] += 1;
            }
        }
    }

    foreach ($buckets as $key => $bucket) {
        $buckets[$key] = finalize_period_bucket($bucket);
    }
    return $buckets;
}

function compare_period_row($key, $base, $next) {
    $base_total = intval($base['total']);
    $next_total = intval($next['total']);
    $base_hours = floatval($base['hours']);
    $next_hours = floatval($next['hours']);
    $base_hour_average = $base_hours > 0 ? $base_total / $base_hours : 0;
    $next_hour_average = $next_hours > 0 ? $next_total / $next_hours : 0;
    $price_effect = ($next_hour_average - $base_hour_average) * (($base_hours + $next_hours) / 2);
    $volume_effect = ($next_hours - $base_hours) * (($base_hour_average + $next_hour_average) / 2);
    $revenue_diff = $next_total - $base_total;

    $assessment_key = 'flat';
    $assessment_label = '변화 작음';
    if ($revenue_diff > 0 && $price_effect >= 0 && $volume_effect >= 0) {
        $assessment_key = 'growth';
        $assessment_label = '단가+대관 증가';
    } elseif ($revenue_diff > 0 && $price_effect > abs($volume_effect)) {
        $assessment_key = 'price';
        $assessment_label = '시간단가 우세';
    } elseif ($revenue_diff > 0 && $volume_effect > 0) {
        $assessment_key = 'volume';
        $assessment_label = '대관량 우세';
    } elseif ($revenue_diff < 0 && $price_effect > 0 && $volume_effect < 0) {
        $assessment_key = 'volume_drop';
        $assessment_label = '대관량 감소';
    } elseif ($revenue_diff < 0) {
        $assessment_key = 'decline';
        $assessment_label = '매출 하락';
    }

    return array(
        'key' => $key,
        'label' => $base['label'],
        'year2025' => $base,
        'year2026' => $next,
        'revenueDiff' => $revenue_diff,
        'revenueRate' => percent_change($base_total, $next_total),
        'countDiff' => intval($next['confirmedCount']) - intval($base['confirmedCount']),
        'countRate' => percent_change(intval($base['confirmedCount']), intval($next['confirmedCount'])),
        'hoursDiff' => round($next_hours - $base_hours, 2),
        'hoursRate' => percent_change($base_hours, $next_hours),
        'hourAverageDiff' => intval(round($next_hour_average - $base_hour_average)),
        'hourAverageRate' => percent_change($base_hour_average, $next_hour_average),
        'priceEffect' => intval(round($price_effect)),
        'volumeEffect' => intval(round($volume_effect)),
        'assessmentKey' => $assessment_key,
        'assessmentLabel' => $assessment_label,
    );
}

function period_analysis_row($pdo, $key, $label, $base_start, $base_end, $next_start, $next_end) {
    $room_order = array('all', 'a', 'b', 'c', 'd', 'e');
    $base = collect_period_revenue($pdo, $base_start, $base_end);
    $next = collect_period_revenue($pdo, $next_start, $next_end);
    $rows = array();
    foreach ($room_order as $room) {
        if (isset($base[$room]) && isset($next[$room])) {
            $rows[] = compare_period_row($room, $base[$room], $next[$room]);
        }
    }
    return array(
        'key' => $key,
        'label' => $label,
        'baseRange' => $base_start . ' ~ ' . $base_end,
        'compareRange' => $next_start . ' ~ ' . $next_end,
        'baseDays' => period_day_count($base_start, $base_end),
        'compareDays' => period_day_count($next_start, $next_end),
        'rows' => $rows,
    );
}

function collect_month_revenue_for_year($pdo, $year) {
    $year = intval($year);
    $start_date = sprintf('%04d-01-01', $year);
    $end_date = sprintf('%04d-12-31', $year);
    $by_month = array();
    for ($month = 1; $month <= 12; $month += 1) {
        $key = sprintf('%04d-%02d', $year, $month);
        $by_month[$key] = empty_month_revenue($key);
    }

    $stmt = $pdo->prepare("
        SELECT DATE_FORMAT(reservation_date, '%Y-%m') AS month_key,
               DAYOFWEEK(reservation_date) AS day_of_week,
               price, gross_amount, fee_amount, net_amount
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date BETWEEN ? AND ?
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
        ORDER BY reservation_date ASC, id ASC
    ");
    $stmt->execute(array($start_date, $end_date));
    foreach ($stmt->fetchAll() as $row) {
        $key = $row['month_key'];
        if (!isset($by_month[$key])) {
            $by_month[$key] = empty_month_revenue($key);
        }
        $amount = ledger_gross_amount($row);
        $by_month[$key]['netTotal'] += ledger_net_amount($row);
        $by_month[$key]['feeTotal'] += ledger_fee_amount($row);
        $by_month[$key]['confirmedCount'] += 1;
        if ($amount > 0) {
            $by_month[$key]['total'] += $amount;
            $day_of_week = intval($row['day_of_week']);
            if ($day_of_week === 1) {
                $by_month[$key]['weekendTotal'] += $amount;
                $by_month[$key]['sundayTotal'] += $amount;
            } elseif ($day_of_week === 7) {
                $by_month[$key]['weekendTotal'] += $amount;
                $by_month[$key]['saturdayTotal'] += $amount;
            } else {
                $by_month[$key]['weekdayTotal'] += $amount;
            }
        } else {
            $by_month[$key]['missingCount'] += 1;
        }
    }

    $months = array();
    foreach ($by_month as $month_row) {
        $months[] = finalize_month_revenue($month_row);
    }
    return $months;
}

function monthly_comparison_stats($pdo) {
    $base_months = collect_month_revenue_for_year($pdo, 2025);
    $next_months = collect_month_revenue_for_year($pdo, 2026);
    $rows = array();
    for ($index = 0; $index < 12; $index += 1) {
        $base = $base_months[$index];
        $next = $next_months[$index];
        $base_total = intval($base['total']);
        $next_total = intval($next['total']);
        $base_count = intval($base['confirmedCount']);
        $next_count = intval($next['confirmedCount']);
        $rows[] = array(
            'month' => $index + 1,
            'label' => sprintf('%d월', $index + 1),
            'year2025' => $base,
            'year2026' => $next,
            'revenueDiff' => $next_total - $base_total,
            'revenueRate' => percent_change($base_total, $next_total),
            'countDiff' => $next_count - $base_count,
            'countRate' => percent_change($base_count, $next_count),
            'bookingAverageDiff' => intval($next['bookingAverage']) - intval($base['bookingAverage']),
        );
    }
    return $rows;
}

function revenue_comparison_stats($pdo) {
    $years = array(2025, 2026);
    $rooms = array('a', 'b', 'c', 'd', 'e');
    $by_year = array();
    $by_room = array();
    foreach ($years as $year) {
        $by_year[$year] = empty_year_revenue($year);
        $by_room[$year] = array();
        foreach ($rooms as $room) {
            $by_room[$year][$room] = empty_room_year_revenue($year, $room);
        }
    }

    $stmt = $pdo->prepare("
        SELECT YEAR(reservation_date) AS year_key,
               room_key,
               TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(end_time, '%H:%i') AS end_time_text,
               price, gross_amount, fee_amount, net_amount
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date BETWEEN '2025-01-01' AND '2026-12-31'
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
        ORDER BY reservation_date ASC, start_time ASC, id ASC
    ");
    $stmt->execute();
    foreach ($stmt->fetchAll() as $row) {
        $year = intval($row['year_key']);
        $room = strtolower((string) $row['room_key']);
        if (!isset($by_year[$year]) || !isset($by_room[$year][$room])) {
            continue;
        }
        $amount = ledger_gross_amount($row);
        $net_amount = ledger_net_amount($row);
        $fee_amount = ledger_fee_amount($row);
        list($start, $end) = booking_time_range_minutes($row['start_time_text'], $row['end_time_text']);
        $hours = max(0, ($end - $start) / 60);

        $by_year[$year]['confirmedCount'] += 1;
        $by_year[$year]['hours'] += $hours;
        $by_year[$year]['netTotal'] += $net_amount;
        $by_year[$year]['feeTotal'] += $fee_amount;
        $by_room[$year][$room]['confirmedCount'] += 1;
        $by_room[$year][$room]['hours'] += $hours;
        $by_room[$year][$room]['netTotal'] += $net_amount;
        $by_room[$year][$room]['feeTotal'] += $fee_amount;
        if ($amount > 0) {
            $by_year[$year]['total'] += $amount;
            $by_room[$year][$room]['total'] += $amount;
        } else {
            $by_year[$year]['missingCount'] += 1;
            $by_room[$year][$room]['missingCount'] += 1;
        }
    }

    foreach ($years as $year) {
        $by_year[$year] = finalize_revenue_bucket($by_year[$year]);
        foreach ($rooms as $room) {
            $by_room[$year][$room] = finalize_revenue_bucket($by_room[$year][$room]);
        }
    }

    $room_compare = array();
    foreach ($rooms as $room) {
        $base = $by_room[2025][$room];
        $next = $by_room[2026][$room];
        $base_total = intval($base['total']);
        $next_total = intval($next['total']);
        $room_compare[] = array(
            'room' => $room,
            'roomLabel' => room_label($room),
            'year2025' => $base,
            'year2026' => $next,
            'revenueDiff' => $next_total - $base_total,
            'revenueRate' => $base_total > 0 ? round((($next_total - $base_total) / $base_total) * 100, 1) : 0,
            'countDiff' => intval($next['confirmedCount']) - intval($base['confirmedCount']),
            'hoursDiff' => round(floatval($next['hours']) - floatval($base['hours']), 2),
            'occupancyDiff' => round(floatval($next['occupancyRate']) - floatval($base['occupancyRate']), 2),
        );
    }

    $as_of = date('Y-m-d');
    if ($as_of < '2026-07-01') {
        $as_of = '2026-07-01';
    } elseif ($as_of > '2026-12-31') {
        $as_of = '2026-12-31';
    }
    $h2_base_end = '2025-' . substr($as_of, 5, 5);

    return array(
        'baseYear' => 2025,
        'compareYear' => 2026,
        'yearSummary' => array_values($by_year),
        'roomComparison' => $room_compare,
        'periodAnalysis' => array(
            period_analysis_row($pdo, 'firstHalf', '상반기', '2025-01-01', '2025-06-30', '2026-01-01', '2026-06-30'),
            period_analysis_row($pdo, 'secondHalfToDate', '하반기 현재일까지', '2025-07-01', $h2_base_end, '2026-07-01', $as_of),
        ),
        'monthlyComparison' => monthly_comparison_stats($pdo),
        'pricePolicy' => array(
            'basis' => '네이버와 스페이스클라우드 동일 기본가 기준. 실제 매출 비교는 DB 원장 금액을 기준으로 합니다.',
            'columns' => array(
                'before16' => '평일 낮',
                'after16' => '16시 이후/주말/공휴일',
                'overnight' => '새벽 통대관',
            ),
            'rows' => price_policy_rows(),
            'history' => price_policy_history_rows($pdo),
        ),
        'experiments' => array(
            'beWeekdayDay' => be_weekday_day_experiment($pdo),
        ),
    );
}

function empty_month_revenue($month) {
    $start = strtotime($month . '-01');
    $days = $start ? intval(date('t', $start)) : 0;
    $weekday_days = 0;
    $weekend_days = 0;
    $saturday_days = 0;
    $sunday_days = 0;
    for ($day = 1; $day <= $days; $day += 1) {
        $ts = strtotime(sprintf('%s-%02d', $month, $day));
        $weekday = intval(date('w', $ts));
        if ($weekday === 0) {
            $weekend_days += 1;
            $sunday_days += 1;
        } elseif ($weekday === 6) {
            $weekend_days += 1;
            $saturday_days += 1;
        } else {
            $weekday_days += 1;
        }
    }
    return array(
        'month' => $month,
        'total' => 0,
        'netTotal' => 0,
        'feeTotal' => 0,
        'confirmedCount' => 0,
        'missingCount' => 0,
        'calendarDays' => $days,
        'weekdayDays' => $weekday_days,
        'weekendDays' => $weekend_days,
        'saturdayDays' => $saturday_days,
        'sundayDays' => $sunday_days,
        'weekdayTotal' => 0,
        'weekendTotal' => 0,
        'saturdayTotal' => 0,
        'sundayTotal' => 0,
    );
}

function finalize_month_revenue($row) {
    $total = intval($row['total']);
    $confirmed_count = intval($row['confirmedCount']);
    $row['dayAverage'] = intval(round($total / max(1, intval($row['calendarDays']))));
    $row['weekdayAverage'] = intval(round(intval($row['weekdayTotal']) / max(1, intval($row['weekdayDays']))));
    $row['weekendAverage'] = intval(round(intval($row['weekendTotal']) / max(1, intval($row['weekendDays']))));
    $row['saturdayAverage'] = intval(round(intval($row['saturdayTotal']) / max(1, intval($row['saturdayDays']))));
    $row['sundayAverage'] = intval(round(intval($row['sundayTotal']) / max(1, intval($row['sundayDays']))));
    $row['bookingAverage'] = intval(round($total / max(1, $confirmed_count - intval($row['missingCount']))));
    return $row;
}

function revenue_stats($pdo, $date) {
    $year = substr($date, 0, 4);
    $selected_month = substr($date, 0, 7);
    $start_date = $year . '-01-01';
    $end_date = $year . '-12-31';
    $stmt = $pdo->prepare("
        SELECT DATE_FORMAT(reservation_date, '%Y-%m') AS month_key,
               DAYOFWEEK(reservation_date) AS day_of_week,
               price, gross_amount, fee_amount, net_amount
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date BETWEEN ? AND ?
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
        ORDER BY reservation_date ASC, id ASC
    ");
    $stmt->execute(array($start_date, $end_date));

    $by_month = array();
    for ($month = 1; $month <= 12; $month += 1) {
        $key = sprintf('%s-%02d', $year, $month);
        $by_month[$key] = empty_month_revenue($key);
    }

    foreach ($stmt->fetchAll() as $row) {
        $key = $row['month_key'];
        if (!isset($by_month[$key])) {
            $by_month[$key] = empty_month_revenue($key);
        }
        $amount = ledger_gross_amount($row);
        $by_month[$key]['netTotal'] += ledger_net_amount($row);
        $by_month[$key]['feeTotal'] += ledger_fee_amount($row);
        $by_month[$key]['confirmedCount'] += 1;
        if ($amount > 0) {
            $by_month[$key]['total'] += $amount;
            $day_of_week = intval($row['day_of_week']);
            if ($day_of_week === 1) {
                $by_month[$key]['weekendTotal'] += $amount;
                $by_month[$key]['sundayTotal'] += $amount;
            } elseif ($day_of_week === 7) {
                $by_month[$key]['weekendTotal'] += $amount;
                $by_month[$key]['saturdayTotal'] += $amount;
            } else {
                $by_month[$key]['weekdayTotal'] += $amount;
            }
        } else {
            $by_month[$key]['missingCount'] += 1;
        }
    }

    $months = array();
    foreach ($by_month as $month_row) {
        $months[] = finalize_month_revenue($month_row);
    }
    $year_total = 0;
    $year_net_total = 0;
    $year_fee_total = 0;
    $year_confirmed_count = 0;
    $year_missing_count = 0;
    foreach ($months as $month_row) {
        $year_total += intval($month_row['total']);
        $year_net_total += intval($month_row['netTotal']);
        $year_fee_total += intval($month_row['feeTotal']);
        $year_confirmed_count += intval($month_row['confirmedCount']);
        $year_missing_count += intval($month_row['missingCount']);
    }

    $selected = isset($by_month[$selected_month]) ? $by_month[$selected_month] : empty_month_revenue($selected_month);
    return array(
        'year' => intval($year),
        'selectedMonth' => $selected_month,
        'selectedMonthTotal' => intval($selected['total']),
        'selectedMonthNetTotal' => intval($selected['netTotal']),
        'selectedMonthFeeTotal' => intval($selected['feeTotal']),
        'selectedMonthConfirmedCount' => intval($selected['confirmedCount']),
        'selectedMonthMissingCount' => intval($selected['missingCount']),
        'yearTotal' => $year_total,
        'yearNetTotal' => $year_net_total,
        'yearFeeTotal' => $year_fee_total,
        'yearConfirmedCount' => $year_confirmed_count,
        'yearMissingCount' => $year_missing_count,
        'months' => $months,
    );
}

function task_action_label($task_type, $platform, $action_type) {
    if ($task_type === 'spacecloud_cancel') {
        return '중복 후예약 취소 - 스페이스클라우드';
    }
    if ($task_type === 'naver_cancel') {
        return '중복 후예약 취소 - 네이버';
    }
    if ($task_type === 'upload') {
        return '스페이스클라우드 등록';
    }
    if ($task_type === 'delete') {
        return '스페이스클라우드 삭제';
    }
    if ($task_type === 'naver_block') {
        return '네이버 예약불가 반영';
    }
    if ($task_type === 'naver_restore') {
        return '네이버 예약가능 복구';
    }
    if ($platform || $action_type) {
        return trim($platform . ' ' . $action_type);
    }
    return '동기화 작업';
}

function task_platform_statuses($task_type, $platform, $status) {
    $naver = '';
    $spacecloud = '';
    if ($task_type === 'naver_cancel') {
        $naver = $status;
        $spacecloud = 'source';
    } elseif ($task_type === 'spacecloud_cancel') {
        $naver = 'source';
        $spacecloud = $status;
    } elseif ($task_type === 'naver_block' || $task_type === 'naver_restore') {
        $naver = $status;
        $spacecloud = 'source';
    } elseif ($task_type === 'upload' || $task_type === 'delete') {
        $naver = 'source';
        $spacecloud = $status;
    } elseif ($platform === 'naver') {
        $naver = $status;
    } elseif ($platform === 'spacecloud') {
        $spacecloud = $status;
    }
    return array($naver ?: '대기', $spacecloud ?: '대기');
}

function task_conflict_booking($booking) {
    if (!is_array($booking)) {
        return null;
    }
    $platform = isset($booking['source_platform']) ? (string) $booking['source_platform'] : '';
    $start = isset($booking['start_time']) ? (string) $booking['start_time'] : '';
    $end = isset($booking['end_time']) ? (string) $booking['end_time'] : '';
    return array(
        'platform' => $platform,
        'platformLabel' => $platform === 'naver' ? '네이버' : ($platform === 'spacecloud' ? '스페이스클라우드' : '예약'),
        'date' => isset($booking['reservation_date']) ? (string) $booking['reservation_date'] : '',
        'room' => strtoupper((string) (isset($booking['room_key']) ? $booking['room_key'] : '')),
        'startHour' => hour_from_time_value($start, false),
        'endHour' => hour_from_time_value($end, true),
        'name' => isset($booking['reserver_name']) ? (string) $booking['reserver_name'] : '',
        'reservationNo' => isset($booking['reservation_number']) ? (string) $booking['reservation_number'] : '',
        'receivedAt' => isset($booking['last_event_at']) ? (string) $booking['last_event_at'] : '',
    );
}

function normalize_task_row($row) {
    $task_type = $row['task_type'] ?: $row['action_type'];
    $result = json_decode((string) ($row['result_text'] ?: ''), true);
    if (!is_array($result)) {
        $result = array();
    }
    $payload = json_decode((string) (isset($row['payload_json']) ? $row['payload_json'] : ''), true);
    if (!is_array($payload)) {
        $payload = array();
    }
    $winning_source = isset($result['winningBooking']) ? $result['winningBooking'] : (isset($payload['winningBooking']) ? $payload['winningBooking'] : null);
    $losing_source = isset($result['losingBooking']) ? $result['losingBooking'] : (isset($payload['losingBooking']) ? $payload['losingBooking'] : null);
    $winning = task_conflict_booking($winning_source);
    $losing = task_conflict_booking($losing_source);
    $sms = isset($result['sms']) && is_array($result['sms']) ? $result['sms'] : array();
    $source_task_id = null;
    if (isset($payload['sourceTaskId'])) {
        $source_task_id = intval($payload['sourceTaskId']);
    } elseif (isset($result['sourceTaskId'])) {
        $source_task_id = intval($result['sourceTaskId']);
    } elseif (isset($result['priorNaverBlockTaskId'])) {
        $source_task_id = intval($result['priorNaverBlockTaskId']);
    }
    list($naver_status, $spacecloud_status) = task_platform_statuses($task_type, $row['platform'], $row['status']);
    return array(
        'id' => (string) $row['id'],
        'reservationId' => $row['reservation_id'] !== null ? intval($row['reservation_id']) : null,
        'liveTaskId' => $row['live_task_id'] !== null ? intval($row['live_task_id']) : null,
        'sourceTaskId' => $source_task_id,
        'taskType' => $task_type,
        'platform' => $row['platform'],
        'actionType' => $row['action_type'],
        'actionLabel' => task_action_label($task_type, $row['platform'], $row['action_type']),
        'status' => $row['status'],
        'resultStatus' => isset($result['status']) ? (string) $result['status'] : '',
        'smsStatus' => isset($sms['status']) ? (string) $sms['status'] : '',
        'error' => isset($result['error']) ? (string) $result['error'] : '',
        'conflict' => ($winning || $losing) ? array(
            'winner' => $winning,
            'loser' => $losing,
        ) : null,
        'date' => $row['reservation_date'],
        'room' => strtoupper((string) $row['room_key']),
        'startHour' => hour_from_time_value($row['start_time_text'], false),
        'endHour' => hour_from_time_value($row['end_time_text'], true),
        'name' => $row['reserver_name'],
        'reservationNo' => $row['reservation_number'],
        'product' => $row['product'],
        'naverStatus' => $naver_status,
        'spacecloudStatus' => $spacecloud_status,
        'createdAt' => $row['created_at'],
        'updatedAt' => $row['updated_at'],
    );
}

function recent_task_rows($pdo) {
    $rows = array();
    $stmt = $pdo->query("
        SELECT t.id, t.reservation_id, t.live_task_id, t.platform, t.action_type,
               COALESCE(l.task_type, t.action_type) AS task_type,
               COALESCE(l.status, t.status) AS status,
               COALESCE(l.result_text, t.result_text) AS result_text,
               COALESCE(l.payload_json, '') AS payload_json,
               r.reservation_date, r.room_key,
               CONCAT(LPAD(r.start_hour, 2, '0'), ':00') AS start_time_text,
               IF(r.end_hour = 24, '00:00', CONCAT(LPAD(r.end_hour, 2, '0'), ':00')) AS end_time_text,
               r.reserver_name, '' AS reservation_number, '' AS product,
               DATE_FORMAT(t.created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at,
               DATE_FORMAT(GREATEST(t.updated_at, COALESCE(l.updated_at, t.updated_at)), '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_admin_sync_tasks t
        JOIN rhythmjoy_admin_reservations r ON r.id = t.reservation_id
        LEFT JOIN rhythmjoy_spacecloud_tasks l ON l.id = t.live_task_id
        WHERE t.status <> 'canceled'
        ORDER BY t.id DESC
        LIMIT 60
    ");
    foreach ($stmt->fetchAll() as $row) {
        $rows[] = normalize_task_row($row);
    }

    $stmt = $pdo->query("
        SELECT CONCAT('live-', l.id) AS id,
               NULL AS reservation_id,
               l.id AS live_task_id,
               CASE
                   WHEN l.task_type IN ('naver_block', 'naver_restore', 'naver_cancel') THEN 'naver'
                   ELSE 'spacecloud'
               END AS platform,
               l.task_type AS action_type,
               l.task_type AS task_type,
               l.status,
               l.result_text,
               l.payload_json,
               l.reservation_date,
               l.room_key,
               TIME_FORMAT(l.start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(l.end_time, '%H:%i') AS end_time_text,
               l.reserver_name,
               l.reservation_number,
               l.product,
               DATE_FORMAT(l.created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at,
               DATE_FORMAT(l.updated_at, '%Y-%m-%dT%H:%i:%s+09:00') AS updated_at
        FROM rhythmjoy_spacecloud_tasks l
        LEFT JOIN rhythmjoy_admin_sync_tasks t ON t.live_task_id = l.id
        WHERE t.id IS NULL
          AND l.task_type IN ('upload', 'delete', 'naver_block', 'naver_restore', 'spacecloud_cancel', 'naver_cancel')
        ORDER BY l.updated_at DESC, l.id DESC
        LIMIT 80
    ");
    foreach ($stmt->fetchAll() as $row) {
        $rows[] = normalize_task_row($row);
    }

    usort($rows, function($a, $b) {
        return strcmp((string) $b['updatedAt'], (string) $a['updatedAt']);
    });
    return array_slice($rows, 0, 80);
}

function reflection_audit_summary($pdo) {
    $stmt = $pdo->query("
        SELECT
            SUM(audit_status='issue') AS issue_count,
            SUM(audit_status='waiting') AS waiting_count,
            SUM(audit_status='ok') AS ok_count,
            MAX(checked_at) AS last_checked_at
        FROM rhythmjoy_reflection_audits
        WHERE checked_at = (SELECT MAX(checked_at) FROM rhythmjoy_reflection_audits)
    ");
    $row = $stmt->fetch();
    if (!$row) {
        return array('issueCount' => 0, 'waitingCount' => 0, 'okCount' => 0, 'lastCheckedAt' => null);
    }
    return array(
        'issueCount' => intval($row['issue_count']),
        'waitingCount' => intval($row['waiting_count']),
        'okCount' => intval($row['ok_count']),
        'lastCheckedAt' => $row['last_checked_at'] ? date('c', strtotime($row['last_checked_at'])) : null,
    );
}

function reflection_audit_rows($pdo) {
    $stmt = $pdo->query("
        SELECT audit_key, ledger_id, source_platform, target_platform, expected_task_type,
               current_status, audit_status, severity, reason, task_id, task_status,
               reservation_date, room_key,
               TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(end_time, '%H:%i') AS end_time_text,
               reserver_name, reservation_number,
               DATE_FORMAT(checked_at, '%Y-%m-%dT%H:%i:%s+09:00') AS checked_at,
               DATE_FORMAT(first_seen_at, '%Y-%m-%dT%H:%i:%s+09:00') AS first_seen_at,
               DATE_FORMAT(resolved_at, '%Y-%m-%dT%H:%i:%s+09:00') AS resolved_at
        FROM rhythmjoy_reflection_audits
        WHERE checked_at = (SELECT MAX(checked_at) FROM rhythmjoy_reflection_audits)
        ORDER BY
            FIELD(audit_status, 'issue', 'waiting', 'ok') ASC,
            FIELD(severity, 'critical', 'warning', 'info') ASC,
            checked_at DESC
        LIMIT 40
    ");
    $rows = array();
    foreach ($stmt->fetchAll() as $row) {
        $source = (string) $row['source_platform'];
        $target = (string) $row['target_platform'];
        $end = (string) $row['end_time_text'];
        if ($end === '00:00' && $row['start_time_text'] !== '00:00') {
            $end = '24:00';
        }
        $rows[] = array(
            'key' => $row['audit_key'],
            'ledgerId' => $row['ledger_id'] !== null ? intval($row['ledger_id']) : null,
            'sourcePlatform' => $source,
            'sourceLabel' => $source === 'naver' ? '네이버' : ($source === 'spacecloud' ? '스페이스클라우드' : '원장'),
            'targetPlatform' => $target,
            'targetLabel' => $target === 'naver' ? '네이버' : ($target === 'spacecloud' ? '스페이스클라우드' : '원장'),
            'taskType' => $row['expected_task_type'],
            'currentStatus' => $row['current_status'],
            'auditStatus' => $row['audit_status'],
            'severity' => $row['severity'],
            'reason' => $row['reason'],
            'taskId' => $row['task_id'] !== null ? intval($row['task_id']) : null,
            'taskStatus' => $row['task_status'],
            'date' => $row['reservation_date'],
            'room' => strtoupper((string) $row['room_key']),
            'start' => $row['start_time_text'],
            'end' => $end,
            'name' => $row['reserver_name'],
            'reservationNo' => $row['reservation_number'],
            'checkedAt' => $row['checked_at'],
            'firstSeenAt' => $row['first_seen_at'],
            'resolvedAt' => $row['resolved_at'],
        );
    }
    return $rows;
}

function industry_snapshot_key() {
    return 'industry-size-segment-2026-07-16-v1';
}

function industry_source_notes() {
    return array(
        'basis' => '방 개수 차이를 보정하기 위해 방 크기군별 방 1개당 월평균 대관시간/매출로 비교합니다.',
        'amountBasis' => '리듬앤조이는 DB 원장 실결제 총액, 경쟁사는 공개 캘린더 대관시간에 공지 가격을 적용한 추정 총액입니다.',
        'sources' => array(
            array('label' => '리듬앤조이 DB 원장', 'url' => 'rhythmjoy_booking_ledger'),
            array('label' => '에이블 사당 공개 캘린더/공지 가격', 'url' => 'https://ablesadang.imweb.me/'),
            array('label' => '디앤에스 공개 캘린더/공지 가격', 'url' => 'https://sites.google.com/view/clubspace'),
            array('label' => '디앤에스 스페이스클라우드 가격 보조자료', 'url' => 'https://clubspace.co.kr/space/15'),
            array('label' => '디앤에스 쉐어잇 가격 보조자료', 'url' => 'https://shareit.kr/store/3354'),
        ),
        'review' => array(
            '전체 연습실 총합 비교는 방 개수와 방 크기 차이 때문에 왜곡됩니다. 이 화면은 대형/중형/소형 크기군으로 나누고 방 1개당 월평균으로 봅니다.',
            'A홀은 경쟁 대형홀보다 시간당 단가와 방당 매출이 높지만, 대관시간은 낮습니다. 전체 가격 인하보다 빈 시간대 쿠폰/프로모션이 우선입니다.',
            'B/E 중형군은 경쟁 중형군보다 대관시간이 낮고 시간당 단가가 높습니다. 상시 인하보다 특정 방/시간대 할인 테스트가 타당합니다.',
            'C/D 소형군은 대관시간이 크게 밀리지 않고 단가도 이미 낮습니다. 가격 인하 우선순위는 B/E보다 낮습니다.',
            '경쟁사 공개 캘린더는 내부 블록, 현장 결제, 취소 반영 방식이 다를 수 있으므로 방향성 비교용입니다.',
        ),
        'exclusions' => array(
            '에이블은 2025 상반기 공개 캘린더 데이터가 사실상 비어 있어 전년대비 판단에서 제외했습니다.',
            '디앤에스 V/W/X/Y/Z는 방 크기 분류가 불확실해 크기군 비교 표에서는 제외했습니다.',
            '디앤에스 A/S는 소형/미확정으로 표기합니다. 정확한 평수가 확인되기 전까지 소형 기준의 보조 비교군입니다.',
        ),
    );
}

function industry_seed_rows() {
    return array(
        array('2025_H1', '2025 상반기', 6, 'rhythmjoy', '리듬앤조이', 'large', '대형(20평+)', 'A홀', 1, 497, 1350.0, 14165000, 10493, 28400, 'actual_db', 'DB 원장 실결제', 110),
        array('2025_H1', '2025 상반기', 6, 'rhythmjoy', '리듬앤조이', 'medium', '중형(10평전후)', 'B홀,E홀', 2, 923, 2044.0, 19490833, 9536, 21117, 'actual_db', 'DB 원장 실결제', 210),
        array('2025_H1', '2025 상반기', 6, 'rhythmjoy', '리듬앤조이', 'small', '소형(6평미만)', 'C홀,D홀', 2, 793, 1450.0, 7473000, 5154, 9424, 'actual_db', 'DB 원장 실결제', 310),
        array('2025_H1', '2025 상반기', 6, 'dns', '디앤에스', 'large', '대형(20평+)', 'B홀,G홀', 2, 938, 2352.0, 21600000, 9184, 23028, 'public_price_estimate', '공개 캘린더 × 공지 가격 추정', 120),
        array('2025_H1', '2025 상반기', 6, 'dns', '디앤에스', 'medium', '중형(10평전후)', 'C홀,D홀,E홀,F홀', 4, 2132, 4502.0, 23442000, 5207, 10995, 'public_price_estimate', '공개 캘린더 × 공지 가격 추정', 220),
        array('2025_H1', '2025 상반기', 6, 'dns', '디앤에스', 'small', '소형/미확정', 'A홀,S홀', 2, 828, 1695.0, 9156500, 5402, 11059, 'public_price_estimate', '평수 미확정 보조 비교군', 320),
        array('2026_H1', '2026 상반기', 6, 'rhythmjoy', '리듬앤조이', 'large', '대형(20평+)', 'A홀', 1, 344, 968.0, 14654000, 15138, 42599, 'actual_db', 'DB 원장 실결제', 110),
        array('2026_H1', '2026 상반기', 6, 'rhythmjoy', '리듬앤조이', 'medium', '중형(10평전후)', 'B홀,E홀', 2, 769, 1649.0, 17776200, 10780, 23116, 'actual_db', 'DB 원장 실결제', 210),
        array('2026_H1', '2026 상반기', 6, 'rhythmjoy', '리듬앤조이', 'small', '소형(6평미만)', 'C홀,D홀', 2, 916, 1520.0, 7622000, 5014, 8319, 'actual_db', 'DB 원장 실결제', 310),
        array('2026_H1', '2026 상반기', 6, 'able', '에이블 사당', 'large', '대형(20평+)', 'D홀(B2)', 1, 358, 1096.0, 11650000, 10630, 32542, 'public_price_estimate', '공개 캘린더 × 공지 가격 추정', 130),
        array('2026_H1', '2026 상반기', 6, 'able', '에이블 사당', 'medium', '중형(10평전후)', 'A홀,B홀,C홀(B1)', 3, 1256, 3022.0, 19492000, 6450, 15519, 'public_price_estimate', '공개 캘린더 × 공지 가격 추정', 230),
        array('2026_H1', '2026 상반기', 6, 'able', '에이블 사당', 'small', '경계(6평)', 'E홀(B2)', 1, 245, 503.0, 2748000, 5463, 11216, 'public_price_estimate', '6평 경계 비교군', 330),
        array('2026_H1', '2026 상반기', 6, 'dns', '디앤에스', 'large', '대형(20평+)', 'B홀,G홀', 2, 891, 2101.0, 19870000, 9457, 22301, 'public_price_estimate', '공개 캘린더 × 공지 가격 추정', 120),
        array('2026_H1', '2026 상반기', 6, 'dns', '디앤에스', 'medium', '중형(10평전후)', 'C홀,D홀,E홀,F홀', 4, 1877, 3820.0, 19990000, 5233, 10650, 'public_price_estimate', '공개 캘린더 × 공지 가격 추정', 220),
        array('2026_H1', '2026 상반기', 6, 'dns', '디앤에스', 'small', '소형/미확정', 'A홀,S홀', 2, 827, 1684.0, 9358000, 5557, 11316, 'public_price_estimate', '평수 미확정 보조 비교군', 320)
    );
}

function ensure_industry_comparison_seed($pdo) {
    $snapshot_key = industry_snapshot_key();
    $stmt = $pdo->prepare("SELECT id FROM rhythmjoy_industry_comparison_snapshots WHERE snapshot_key=? LIMIT 1");
    $stmt->execute(array($snapshot_key));
    if ($stmt->fetch()) {
        return;
    }

    $notes = industry_source_notes();
    $pdo->beginTransaction();
    try {
        $insert_snapshot = $pdo->prepare("
            INSERT INTO rhythmjoy_industry_comparison_snapshots (
                snapshot_key, title, basis, source_notes, generated_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, NOW())
        ");
        $insert_snapshot->execute(array(
            $snapshot_key,
            '사당권 연습실 업계 비교 2026-07-16',
            $notes['basis'],
            json_encode($notes, JSON_UNESCAPED_UNICODE),
            '2026-07-16 14:18:00',
        ));
        $snapshot_id = intval($pdo->lastInsertId());
        $insert_row = $pdo->prepare("
            INSERT INTO rhythmjoy_industry_comparison_rows (
                snapshot_id, period_key, period_label, period_months,
                studio_key, studio_label, group_key, group_label,
                room_labels, room_count, events_count, hours, gross_amount,
                avg_per_hour, avg_per_event, amount_basis, note, display_order, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ");
        foreach (industry_seed_rows() as $row) {
            $insert_row->execute(array_merge(array($snapshot_id), $row));
        }
        $pdo->commit();
    } catch (Exception $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function industry_row_from_db($row) {
    $room_count = max(1, intval($row['room_count']));
    $months = max(0.1, floatval($row['period_months']));
    $hours = floatval($row['hours']);
    $gross = intval($row['gross_amount']);
    return array(
        'periodKey' => $row['period_key'],
        'periodLabel' => $row['period_label'],
        'studioKey' => $row['studio_key'],
        'studioLabel' => $row['studio_label'],
        'groupKey' => $row['group_key'],
        'groupLabel' => $row['group_label'],
        'roomLabels' => $row['room_labels'],
        'roomCount' => $room_count,
        'events' => intval($row['events_count']),
        'hours' => round($hours, 1),
        'gross' => $gross,
        'avgPerHour' => intval($row['avg_per_hour']),
        'avgPerEvent' => intval($row['avg_per_event']),
        'hoursPerRoomMonth' => round($hours / $room_count / $months, 1),
        'grossPerRoomMonth' => intval(round($gross / $room_count / $months)),
        'amountBasis' => $row['amount_basis'],
        'note' => $row['note'],
        'displayOrder' => intval($row['display_order']),
    );
}

function industry_comparison_deltas($rows) {
    $by_key = array();
    foreach ($rows as $row) {
        $key = $row['studioKey'] . '|' . $row['groupKey'];
        if (!isset($by_key[$key])) {
            $by_key[$key] = array();
        }
        $by_key[$key][$row['periodKey']] = $row;
    }
    $result = array();
    foreach ($by_key as $periods) {
        if (!isset($periods['2025_H1'], $periods['2026_H1'])) {
            continue;
        }
        $base = $periods['2025_H1'];
        $next = $periods['2026_H1'];
        if ($base['studioKey'] === 'able' || $base['events'] < 20) {
            continue;
        }
        $base_avg_per_hour = $base['hours'] > 0 ? ($base['gross'] / $base['hours']) : 0;
        $next_avg_per_hour = $next['hours'] > 0 ? ($next['gross'] / $next['hours']) : 0;
        $hours_diff = round($next['hours'] - $base['hours'], 1);
        $hours_per_room_month_diff = round($next['hoursPerRoomMonth'] - $base['hoursPerRoomMonth'], 1);
        $volume_revenue_effect = intval(round($hours_diff * $base_avg_per_hour));
        $rate_revenue_effect = intval(round(($next_avg_per_hour - $base_avg_per_hour) * $next['hours']));
        $lost_revenue_estimate = $volume_revenue_effect < 0 ? abs($volume_revenue_effect) : 0;
        $lost_revenue_per_room_month_estimate = $hours_per_room_month_diff < 0
            ? intval(round(abs($hours_per_room_month_diff) * $base_avg_per_hour))
            : 0;
        $result[] = array(
            'studioKey' => $next['studioKey'],
            'studioLabel' => $next['studioLabel'],
            'groupKey' => $next['groupKey'],
            'groupLabel' => $next['groupLabel'],
            'roomLabels' => $next['roomLabels'],
            'eventsDiff' => $next['events'] - $base['events'],
            'eventsRate' => percent_change($base['events'], $next['events']),
            'hoursDiff' => $hours_diff,
            'hoursRate' => percent_change($base['hours'], $next['hours']),
            'grossDiff' => $next['gross'] - $base['gross'],
            'grossRate' => percent_change($base['gross'], $next['gross']),
            'avgPerHourDiff' => $next['avgPerHour'] - $base['avgPerHour'],
            'avgPerHourRate' => percent_change($base['avgPerHour'], $next['avgPerHour']),
            'baseAvgPerHour' => intval(round($base_avg_per_hour)),
            'nextAvgPerHour' => intval(round($next_avg_per_hour)),
            'volumeRevenueEffect' => $volume_revenue_effect,
            'rateRevenueEffect' => $rate_revenue_effect,
            'lostRevenueEstimate' => $lost_revenue_estimate,
            'lostRevenuePerRoomMonthEstimate' => $lost_revenue_per_room_month_estimate,
            'hoursPerRoomMonthDiff' => $hours_per_room_month_diff,
            'grossPerRoomMonthDiff' => $next['grossPerRoomMonth'] - $base['grossPerRoomMonth'],
        );
    }
    usort($result, function($a, $b) {
        $group_order = array('large' => 1, 'medium' => 2, 'small' => 3);
        $a_group = isset($group_order[$a['groupKey']]) ? $group_order[$a['groupKey']] : 9;
        $b_group = isset($group_order[$b['groupKey']]) ? $group_order[$b['groupKey']] : 9;
        if ($a_group !== $b_group) {
            return $a_group - $b_group;
        }
        return strcmp($a['studioLabel'], $b['studioLabel']);
    });
    return $result;
}

function industry_comparison_stats($pdo) {
    ensure_industry_comparison_seed($pdo);
    $snapshot_key = industry_snapshot_key();
    $stmt = $pdo->prepare("SELECT * FROM rhythmjoy_industry_comparison_snapshots WHERE snapshot_key=? LIMIT 1");
    $stmt->execute(array($snapshot_key));
    $snapshot = $stmt->fetch();
    if (!$snapshot) {
        return null;
    }
    $stmt = $pdo->prepare("
        SELECT *
        FROM rhythmjoy_industry_comparison_rows
        WHERE snapshot_id=?
        ORDER BY display_order ASC, studio_label ASC, period_key ASC
    ");
    $stmt->execute(array(intval($snapshot['id'])));
    $rows = array_map('industry_row_from_db', $stmt->fetchAll());
    $notes = json_decode((string) $snapshot['source_notes'], true);
    if (!is_array($notes)) {
        $notes = industry_source_notes();
    }

    $groups = array();
    $group_labels = array('large' => '대형(20평 이상)', 'medium' => '중형(10평 전후)', 'small' => '소형/경계');
    foreach ($rows as $row) {
        if ($row['periodKey'] !== '2026_H1') {
            continue;
        }
        $key = $row['groupKey'];
        if (!isset($groups[$key])) {
            $groups[$key] = array(
                'key' => $key,
                'label' => isset($group_labels[$key]) ? $group_labels[$key] : $row['groupLabel'],
                'rows' => array(),
            );
        }
        $groups[$key]['rows'][] = $row;
    }

    $ordered_groups = array();
    foreach (array('large', 'medium', 'small') as $key) {
        if (isset($groups[$key])) {
            $ordered_groups[] = $groups[$key];
        }
    }

    return array(
        'snapshot' => array(
            'key' => $snapshot['snapshot_key'],
            'title' => $snapshot['title'],
            'generatedAt' => $snapshot['generated_at'],
            'basis' => $snapshot['basis'],
        ),
        'currentPeriod' => '2026_H1',
        'basePeriod' => '2025_H1',
        'groups' => $ordered_groups,
        'deltas' => industry_comparison_deltas($rows),
        'review' => isset($notes['review']) ? $notes['review'] : array(),
        'exclusions' => isset($notes['exclusions']) ? $notes['exclusions'] : array(),
        'sources' => isset($notes['sources']) ? $notes['sources'] : array(),
        'amountBasis' => isset($notes['amountBasis']) ? $notes['amountBasis'] : '',
    );
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
        'adminSeries' => admin_series_rows($pdo),
        'tasks' => recent_task_rows($pdo),
        'reflectionAudits' => reflection_audit_rows($pdo),
        'reflectionAuditSummary' => reflection_audit_summary($pdo),
        'revenueStats' => revenue_stats($pdo, $date),
        'revenueComparison' => revenue_comparison_stats($pdo),
        'industryComparison' => industry_comparison_stats($pdo),
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

function sync_admin_live_enabled($env) {
    return isset($env['SYNC_ADMIN_ENQUEUE_LIVE_TASKS']) && trim($env['SYNC_ADMIN_ENQUEUE_LIVE_TASKS']) === '1';
}

function room_calendar_key($room) {
    $map = array(
        'A' => 'Ahall',
        'B' => 'Bhall',
        'C' => 'Chall',
        'D' => 'Dhall',
        'E' => 'Ehall',
    );
    return isset($map[$room]) ? $map[$room] : '';
}

function room_product_name($room) {
    $map = array(
        'A' => 'A홀 20평형-외부신발금지',
        'B' => 'B홀 16평형-외부신발금지',
        'C' => 'C홀 6평형-외부신발금지',
        'D' => 'D홀 4평형-외부신발금지',
        'E' => 'E홀 4평형-외부신발금지',
    );
    return isset($map[$room]) ? $map[$room] : $room . '홀';
}

function hour_time_text($hour) {
    $hour = intval($hour);
    if ($hour === 24) {
        return '24:00';
    }
    return sprintf('%02d:00', $hour);
}

function normalize_reserver_name_key($name) {
    $name = preg_replace('/\s+/u', '', (string) $name);
    $name = preg_replace('/님+$/u', '', $name);
    return function_exists('mb_strtolower') ? mb_strtolower($name, 'UTF-8') : strtolower($name);
}

function booking_ledger_key_for_admin($source_platform, $event, $calendar_key) {
    $reservation_number = isset($event['reservation_number']) ? $event['reservation_number'] : '';
    if ($source_platform !== 'spacecloud' && $reservation_number !== '') {
        $raw_key = $source_platform . '|reservation|' . $reservation_number;
    } else {
        $raw_key = implode('|', array(
            $source_platform,
            $calendar_key,
            $event['date'],
            $event['start_time'],
            $event['end_time'],
            normalize_reserver_name_key($event['name']),
        ));
    }
    return $source_platform . '|' . hash('sha256', $raw_key);
}

function upload_dedupe_key_for_admin($event, $room_key) {
    $reservation_number = isset($event['reservation_number']) ? $event['reservation_number'] : '';
    if ($reservation_number !== '') {
        $raw_key = 'upload|reservation|' . $reservation_number;
    } else {
        $raw_key = implode('|', array(
            'upload',
            $room_key,
            $event['date'],
            $event['start_time'],
            $event['end_time'],
            $event['name'],
        ));
    }
    return 'upload|' . hash('sha256', $raw_key);
}

function naver_block_dedupe_key_for_admin($event, $room_key) {
    $raw_key = implode('|', array(
        'naver_block',
        $room_key,
        $event['date'],
        $event['start_time'],
        $event['end_time'],
        normalize_reserver_name_key($event['name']),
    ));
    return 'naver_block|' . hash('sha256', $raw_key);
}

function live_task_dedupe_key_for_admin($task_type, $event, $room_key) {
    if ($task_type === 'upload') {
        return upload_dedupe_key_for_admin($event, $room_key);
    }
    if ($task_type === 'naver_block') {
        return naver_block_dedupe_key_for_admin($event, $room_key);
    }
    $raw_key = implode('|', array(
        $task_type,
        $event['reservation_number'],
        $room_key,
        $event['date'],
        $event['start_time'],
        $event['end_time'],
        normalize_reserver_name_key($event['name']),
    ));
    return $task_type . '|' . hash('sha256', $raw_key);
}

function insert_admin_ledger_anchor($pdo, $source_platform, $event, $calendar_key, $room_key) {
    $stmt = $pdo->prepare("
        INSERT INTO rhythmjoy_booking_ledger (
            ledger_key, source_platform, source_mode, current_status,
            target_calendar, room_key, reservation_number, reserver_name, reserver_name_key, product,
            reservation_date, start_time, end_time,
            payment_status, price,
            gross_amount, fee_amount, net_amount, amount_source, payment_method,
            confirmed_email_event_id, confirmed_email_received_at, last_event_at,
            payload_json, created_at, updated_at
        )
        VALUES (
            ?, ?, 'admin-task-anchor', 'confirmed',
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?,
            '관리자입력', '',
            NULL, NULL, NULL, 'admin_anchor', '',
            NULL, NOW(), NOW(),
            ?, NOW(), NOW()
        )
        ON DUPLICATE KEY UPDATE
            current_status='confirmed',
            target_calendar=VALUES(target_calendar),
            room_key=VALUES(room_key),
            reservation_number=VALUES(reservation_number),
            reserver_name=VALUES(reserver_name),
            reserver_name_key=VALUES(reserver_name_key),
            product=VALUES(product),
            reservation_date=VALUES(reservation_date),
            start_time=VALUES(start_time),
            end_time=VALUES(end_time),
            payment_status=VALUES(payment_status),
            amount_source=VALUES(amount_source),
            confirmed_email_received_at=NOW(),
            last_event_at=NOW(),
            payload_json=VALUES(payload_json),
            updated_at=NOW()
    ");
    $payload_json = json_encode($event, JSON_UNESCAPED_UNICODE);
    $stmt->execute(array(
        booking_ledger_key_for_admin($source_platform, $event, $calendar_key),
        $source_platform,
        $calendar_key,
        $room_key,
        $source_platform === 'spacecloud' ? '' : $event['reservation_number'],
        $event['name'],
        normalize_reserver_name_key($event['name']),
        $event['product'],
        $event['date'],
        $event['start_time'],
        $event['end_time'],
        $payload_json,
    ));
}

function insert_live_spacecloud_task($pdo, $task_type, $event, $room_key) {
    if (!in_array($task_type, array('upload', 'delete', 'naver_block', 'naver_restore'), true)) {
        throw new InvalidArgumentException('지원하지 않는 관리자 동기화 작업입니다.');
    }
    $dedupe_key = live_task_dedupe_key_for_admin($task_type, $event, $room_key);
    $payload_json = json_encode($event, JSON_UNESCAPED_UNICODE);
    $stmt = $pdo->prepare("
        INSERT INTO rhythmjoy_spacecloud_tasks (
            dedupe_key, email_event_id, task_type, status,
            room_key, reservation_number, reserver_name, product,
            reservation_date, start_time, end_time, payload_json,
            created_at, updated_at
        )
        VALUES (
            ?, NULL, ?, 'pending',
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            NOW(), NOW()
        )
        ON DUPLICATE KEY UPDATE
            room_key=VALUES(room_key),
            reservation_number=VALUES(reservation_number),
            reserver_name=VALUES(reserver_name),
            product=VALUES(product),
            reservation_date=VALUES(reservation_date),
            start_time=VALUES(start_time),
            end_time=VALUES(end_time),
            payload_json=VALUES(payload_json),
            status=IF(status IN ('done', 'already_gone', 'needs_review', 'google_pending'), status, 'pending'),
            updated_at=NOW()
    ");
    $stmt->execute(array(
        $dedupe_key,
        $task_type,
        $room_key,
        $event['reservation_number'],
        $event['name'],
        $event['product'],
        $event['date'],
        $event['start_time'],
        $event['end_time'],
        $payload_json,
    ));
    $select = $pdo->prepare("SELECT id, status FROM rhythmjoy_spacecloud_tasks WHERE dedupe_key=? LIMIT 1");
    $select->execute(array($dedupe_key));
    return $select->fetch();
}

function admin_event_payload($reservation_id, $date, $room, $start, $end, $name, $memo, $phone_last4, $extra = array()) {
    $room_key = strtolower($room);
    $calendar_key = room_calendar_key($room);
    $event = array(
        'source' => 'admin-panel',
        'source_mode' => 'admin-panel',
        'action' => 'admin-manual-reservation',
        'calendarKey' => $calendar_key,
        'calendar_key' => $calendar_key,
        'target_calendar' => $calendar_key,
        'roomKey' => $room_key,
        'room_key' => $room_key,
        'date' => $date,
        'start_time' => hour_time_text($start),
        'end_time' => hour_time_text($end),
        'name' => $name,
        'product' => room_product_name($room),
        'reservation_number' => 'ADMIN-' . intval($reservation_id),
        'payment_status' => '관리자입력',
        'memo' => $memo,
        'phone_last4' => $phone_last4,
        'admin_reservation_id' => intval($reservation_id),
    );
    foreach ($extra as $key => $value) {
        $event[$key] = $value;
    }
    return $event;
}

function insert_admin_sync_task($pdo, $reservation_id, $live_task, $action_type, $platform, $env) {
    $status = $live_task && isset($live_task['status']) ? $live_task['status'] : 'pending';
    $stmt = $pdo->prepare("
        INSERT INTO rhythmjoy_admin_sync_tasks (
            reservation_id, live_task_id, action_type, platform, status, result_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    ");
    $stmt->execute(array(
        $reservation_id,
        $live_task ? intval($live_task['id']) : null,
        $action_type,
        $platform,
        $status,
        sync_admin_live_enabled($env) ? '실행 큐 생성됨' : '관리자 패널에서 생성됨',
    ));
}

function queue_admin_registration($pdo, $event, $env) {
    $room_key = $event['room_key'];
    $calendar_key = $event['calendar_key'];
    $naver_task = null;
    $spacecloud_task = null;
    if (sync_admin_live_enabled($env)) {
        insert_admin_ledger_anchor($pdo, 'naver', $event, $calendar_key, $room_key);
        insert_admin_ledger_anchor($pdo, 'spacecloud', $event, $calendar_key, $room_key);
        $naver_task = insert_live_spacecloud_task($pdo, 'naver_block', $event, $room_key);
        $spacecloud_task = insert_live_spacecloud_task($pdo, 'upload', $event, $room_key);
    }
    insert_admin_sync_task($pdo, $event['admin_reservation_id'], $naver_task, 'block_naver_availability', 'naver', $env);
    insert_admin_sync_task($pdo, $event['admin_reservation_id'], $spacecloud_task, 'add_spacecloud_reservation', 'spacecloud', $env);
}

function update_admin_ledger_status($pdo, $event, $status) {
    $stmt = $pdo->prepare("
        UPDATE rhythmjoy_booking_ledger
        SET current_status=?, last_event_at=NOW(), updated_at=NOW()
        WHERE ledger_key IN (?, ?)
          AND source_mode='admin-task-anchor'
    ");
    $stmt->execute(array(
        $status,
        booking_ledger_key_for_admin('naver', $event, $event['calendar_key']),
        booking_ledger_key_for_admin('spacecloud', $event, $event['calendar_key']),
    ));
}

function queue_admin_cancellation($pdo, $event, $env) {
    update_admin_ledger_status($pdo, $event, 'canceled');
    $delete_task = null;
    $restore_task = null;
    if (sync_admin_live_enabled($env)) {
        $delete_task = insert_live_spacecloud_task($pdo, 'delete', $event, $event['room_key']);
        $restore_task = insert_live_spacecloud_task($pdo, 'naver_restore', $event, $event['room_key']);
    }
    insert_admin_sync_task($pdo, $event['admin_reservation_id'], $delete_task, 'delete_spacecloud_reservation', 'spacecloud', $env);
    insert_admin_sync_task($pdo, $event['admin_reservation_id'], $restore_task, 'restore_naver_availability', 'naver', $env);
}

function create_reservation($pdo, $payload, $env) {
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

    $room_key = strtolower($room);
    $calendar_key = room_calendar_key($room);
    $product = room_product_name($room);
    $start_time = hour_time_text($start);
    $end_time = hour_time_text($end);

    $ledger_overlap = $pdo->prepare("
        SELECT id, reserver_name,
               TIME_FORMAT(start_time, '%H:%i') AS start_time_text,
               TIME_FORMAT(end_time, '%H:%i') AS end_time_text
        FROM rhythmjoy_booking_ledger
        WHERE reservation_date = ?
          AND room_key = ?
          AND current_status <> 'canceled'
          AND COALESCE(source_mode, '') <> 'admin-task-anchor'
          AND source_platform <> 'google-backfill'
          AND start_time < ?
          AND end_time > ?
        LIMIT 1
    ");
    $ledger_overlap->execute(array($date, $room_key, $end_time, $start_time));
    $ledger_existing = $ledger_overlap->fetch();
    if ($ledger_existing) {
        json_response(array(
            'ok' => false,
            'error' => 'overlap',
            'message' => $room . '홀 ' . $ledger_existing['start_time_text'] . '-' . $ledger_existing['end_time_text'] . ' 예약과 겹칩니다.',
        ), 409);
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
        $event = admin_event_payload($reservation_id, $date, $room, $start, $end, $name, $memo, $phone_last4);
        queue_admin_registration($pdo, $event, $env);
        $pdo->commit();
    } catch (Exception $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function create_recurring_reservations($pdo, $payload, $env) {
    $title = trim((string) (isset($payload['title']) ? $payload['title'] : ''));
    $name = trim((string) (isset($payload['name']) ? $payload['name'] : ''));
    $memo = trim((string) (isset($payload['memo']) ? $payload['memo'] : ''));
    $phone = clean_phone(isset($payload['phone']) ? $payload['phone'] : '');
    $request_id = trim((string) (isset($payload['requestId']) ? $payload['requestId'] : ''));
    if ($title === '' || $name === '') {
        throw new InvalidArgumentException('정기대관명과 예약자명이 필요합니다.');
    }
    if ($request_id === '' || strlen($request_id) > 128) {
        throw new InvalidArgumentException('정기대관 요청 식별값이 올바르지 않습니다.');
    }

    $preview = recurring_preview_payload($pdo, $payload);
    if (intval($preview['summary']['included']) < 1) {
        throw new InvalidArgumentException('등록할 날짜가 없습니다.');
    }
    if (intval($preview['summary']['conflicts']) > 0) {
        throw new InvalidArgumentException('충돌 날짜를 제외하거나 홀·시간을 변경한 뒤 다시 검사해주세요.');
    }

    $series_key = 'series:' . hash('sha256', $request_id);
    $existing = $pdo->prepare("SELECT id FROM rhythmjoy_admin_series WHERE series_key=? LIMIT 1");
    $existing->execute(array($series_key));
    $existing_row = $existing->fetch();
    if ($existing_row) {
        return array('seriesId' => intval($existing_row['id']), 'createdCount' => 0, 'duplicateRequest' => true);
    }

    $phone_last4 = $phone !== '' ? substr($phone, -4) : '';
    $phone_hash = $phone !== '' ? hash('sha256', $phone) : '';
    $definition = array(
        'rules' => $preview['rules'],
        'fifthWeekPolicy' => $preview['fifthWeekPolicy'],
        'occurrences' => $preview['occurrences'],
        'previewHash' => $preview['previewHash'],
    );
    $included = array_values(array_filter($preview['occurrences'], function($row) { return $row['included']; }));

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("
            INSERT INTO rhythmjoy_admin_series (
                series_key, title, start_date, end_date, fifth_week_policy, definition_json,
                reserver_name, phone_hash, phone_last4, memo, status, occurrence_count,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NOW(), NOW())
        ");
        $stmt->execute(array(
            $series_key,
            substr($title, 0, 128),
            $preview['startDate'],
            $preview['endDate'],
            $preview['fifthWeekPolicy'],
            json_encode($definition, JSON_UNESCAPED_UNICODE),
            substr($name, 0, 128),
            $phone_hash,
            $phone_last4,
            substr($memo, 0, 255),
            count($included),
        ));
        $series_id = intval($pdo->lastInsertId());
        $insert = $pdo->prepare("
            INSERT INTO rhythmjoy_admin_reservations (
                series_id, occurrence_order, rule_index, reservation_key,
                reservation_date, room_key, start_hour, end_hour,
                reserver_name, phone_hash, phone_last4, memo, source, status,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', 'pending', NOW(), NOW())
        ");
        foreach ($included as $order => $occurrence) {
            $reservation_key = 'admin-series:' . hash('sha256', $series_key . '|' . $occurrence['key']);
            $insert->execute(array(
                $series_id,
                $order + 1,
                intval($occurrence['ruleIndex']),
                $reservation_key,
                $occurrence['date'],
                $occurrence['room'],
                intval($occurrence['start']),
                intval($occurrence['end']),
                substr($name, 0, 128),
                $phone_hash,
                $phone_last4,
                substr($memo, 0, 255),
            ));
            $reservation_id = intval($pdo->lastInsertId());
            $event = admin_event_payload(
                $reservation_id,
                $occurrence['date'],
                $occurrence['room'],
                $occurrence['start'],
                $occurrence['end'],
                $name,
                $memo,
                $phone_last4,
                array(
                    'action' => 'admin-recurring-reservation',
                    'admin_series_id' => $series_id,
                    'occurrence_key' => $occurrence['key'],
                    'suppress_confirmation_sms' => true,
                )
            );
            queue_admin_registration($pdo, $event, $env);
        }
        $pdo->commit();
        return array('seriesId' => $series_id, 'createdCount' => count($included), 'duplicateRequest' => false);
    } catch (Exception $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function cancel_admin_reservations($pdo, $payload, $env) {
    $ids = array();
    if (isset($payload['reservationIds']) && is_array($payload['reservationIds'])) {
        foreach ($payload['reservationIds'] as $value) {
            $id = intval($value);
            if ($id > 0) $ids[$id] = true;
        }
    }
    $series_id = isset($payload['seriesId']) ? intval($payload['seriesId']) : 0;
    $scope = isset($payload['scope']) ? (string) $payload['scope'] : 'selected';
    $from_date = date('Y-m-d');
    if ($series_id > 0 && in_array($scope, array('all', 'future'), true)) {
        $sql = "SELECT id FROM rhythmjoy_admin_reservations
                WHERE series_id=? AND reservation_date>=?
                  AND status NOT IN ('canceled','canceling')";
        $params = array($series_id, $from_date);
        $stmt = $pdo->prepare($sql . ' ORDER BY reservation_date, id LIMIT 500');
        $stmt->execute($params);
        foreach ($stmt->fetchAll() as $row) $ids[intval($row['id'])] = true;
    }
    $ids = array_keys($ids);
    if (!$ids || count($ids) > 500) {
        throw new InvalidArgumentException('취소할 오늘 이후 관리자 일정이 없습니다.');
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("
            SELECT id, series_id, reservation_date, room_key, start_hour, end_hour,
                   reserver_name, phone_last4, memo, status
            FROM rhythmjoy_admin_reservations
            WHERE id IN ($placeholders)
              AND reservation_date >= ?
              AND status NOT IN ('canceled','canceling')
            FOR UPDATE
        ");
        $stmt->execute(array_merge($ids, array($from_date)));
        $rows = $stmt->fetchAll();
        if (!$rows) {
            throw new InvalidArgumentException('지난 일정은 취소할 수 없습니다. 오늘 이후 일정을 선택해주세요.');
        }
        $updated = $pdo->prepare("UPDATE rhythmjoy_admin_reservations SET status=?, updated_at=NOW() WHERE id=?");
        $series_ids = array();
        foreach ($rows as $row) {
            $next_status = sync_admin_live_enabled($env) ? 'canceling' : 'canceled';
            $updated->execute(array($next_status, intval($row['id'])));
            $event = admin_event_payload(
                intval($row['id']),
                $row['reservation_date'],
                strtoupper($row['room_key']),
                intval($row['start_hour']),
                intval($row['end_hour']),
                $row['reserver_name'],
                $row['memo'],
                $row['phone_last4'],
                array('action' => 'admin-reservation-cancellation', 'suppress_confirmation_sms' => true)
            );
            queue_admin_cancellation($pdo, $event, $env);
            if ($row['series_id']) $series_ids[intval($row['series_id'])] = true;
        }
        foreach (array_keys($series_ids) as $affected_series_id) {
            $stmt = $pdo->prepare("UPDATE rhythmjoy_admin_series SET status='canceling', updated_at=NOW() WHERE id=? AND status<>'canceled'");
            $stmt->execute(array($affected_series_id));
        }
        $pdo->commit();
        return array('requestedCount' => count($rows));
    } catch (Exception $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
}

function sync_admin_selftest_assert($condition, $message) {
    if (!$condition) {
        throw new RuntimeException('self-test failed: ' . $message);
    }
}

function run_sync_admin_selftest() {
    sync_admin_selftest_assert(clean_date_value('2026-02-29') === '', 'invalid calendar dates are rejected');
    sync_admin_selftest_assert(clean_date_value('2028-02-29') === '2028-02-29', 'valid leap dates are accepted');
    list($rules, $included_rows) = generate_recurring_occurrences(
        '2026-08-01',
        '2026-08-31',
        array(
            array('weekday' => 1, 'room' => 'C', 'start' => 13, 'end' => 15),
            array('weekday' => 5, 'room' => 'C', 'start' => 16, 'end' => 17),
        ),
        'include'
    );
    sync_admin_selftest_assert(count($rules) === 2, 'two weekday rules remain distinct');
    sync_admin_selftest_assert(count($included_rows) === 9, 'August 2026 has five Mondays and four Fridays');
    $fifth = array_values(array_filter($included_rows, function($row) { return $row['fifthWeek']; }));
    sync_admin_selftest_assert(count($fifth) === 1 && $fifth[0]['date'] === '2026-08-31', 'fifth weekday is detected by its exact date');

    list($ignored_rules, $excluded_rows) = generate_recurring_occurrences(
        '2026-08-01',
        '2026-08-31',
        array(array('weekday' => 1, 'room' => 'C', 'start' => 13, 'end' => 15)),
        'exclude'
    );
    $excluded = array_values(array_filter($excluded_rows, function($row) { return !$row['included']; }));
    sync_admin_selftest_assert(count($excluded) === 1 && $excluded[0]['date'] === '2026-08-31', 'only the fifth Monday is excluded');

    $overrides = normalize_recurring_occurrences(array(array(
        'key' => 'r0:2026-08-31',
        'originalDate' => '2026-08-31',
        'date' => '2026-09-01',
        'ruleIndex' => 0,
        'room' => 'D',
        'start' => 14,
        'end' => 16,
        'included' => true,
        'modified' => true,
    )));
    sync_admin_selftest_assert($overrides[0]['date'] === '2026-09-01' && $overrides[0]['room'] === 'D' && $overrides[0]['modified'], 'one occurrence can move without changing the series rule');

    $too_long_rejected = false;
    try {
        recurring_date_range('2026-01-01', '2027-01-02');
    } catch (InvalidArgumentException $error) {
        $too_long_rejected = true;
    }
    sync_admin_selftest_assert($too_long_rejected, 'periods longer than one year are rejected');
    echo "sync-admin self-test OK: recurring weekdays, fifth-week exclusion, per-date override, one-year limit\n";
}

if (PHP_SAPI === 'cli' && isset($argv[1]) && $argv[1] === 'self-test') {
    run_sync_admin_selftest();
    exit(0);
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

    if ($action === 'month_summary') {
        json_response(array(
            'ok' => true,
            'serverTime' => date('c'),
            'monthSummary' => month_summary($pdo, $date),
        ));
    }

    if ($action === 'day_reservations') {
        json_response(array(
            'ok' => true,
            'serverTime' => date('c'),
            'date' => $date,
            'reservations' => reservation_rows($pdo, $date),
        ));
    }

    if ($action === 'preview_recurring') {
        json_response(recurring_preview_payload($pdo, $payload));
    }

    if ($action === 'series_occurrences') {
        $series_id = isset($payload['seriesId']) ? intval($payload['seriesId']) : 0;
        if ($series_id < 1) {
            throw new InvalidArgumentException('정기대관을 선택해주세요.');
        }
        json_response(array(
            'ok' => true,
            'seriesId' => $series_id,
            'occurrences' => admin_series_occurrence_rows($pdo, $series_id),
        ));
    }

    if ($action === 'create_reservation') {
        create_reservation($pdo, $payload, $env);
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    if ($action === 'create_recurring') {
        $result = create_recurring_reservations($pdo, $payload, $env);
        json_response(array_merge(bootstrap_payload($pdo, $date, $env), array('recurringResult' => $result)));
    }

    if ($action === 'cancel_admin_reservations') {
        $result = cancel_admin_reservations($pdo, $payload, $env);
        json_response(array_merge(bootstrap_payload($pdo, $date, $env), array('cancelResult' => $result)));
    }

    if ($action === 'clear_drafts') {
        $pdo->exec("UPDATE rhythmjoy_admin_sync_tasks SET status='canceled', updated_at=NOW() WHERE status='pending' AND live_task_id IS NULL");
        $pdo->exec("
            UPDATE rhythmjoy_admin_reservations r
            SET r.status='canceled', r.updated_at=NOW()
            WHERE r.source='admin' AND r.status='pending' AND r.series_id IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM rhythmjoy_admin_sync_tasks t
                  WHERE t.reservation_id=r.id AND t.live_task_id IS NOT NULL
              )
        ");
        json_response(bootstrap_payload($pdo, $date, $env));
    }

    if ($action === 'save_profile') {
        upsert_setting($pdo, 'automation_profile', trim((string) (isset($payload['profilePath']) ? $payload['profilePath'] : '')));
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
} catch (InvalidArgumentException $error) {
    json_response(array(
        'ok' => false,
        'error' => 'invalid_input',
        'message' => $error->getMessage(),
    ), 400);
} catch (Exception $error) {
    json_response(array(
        'ok' => false,
        'error' => 'server_error',
        'message' => $error->getMessage(),
    ), 500);
}
