<?php

// This test uses connection-scoped TEMPORARY tables that shadow production
// table names. It exercises real MySQL uniqueness and transaction behavior
// without creating a production reservation, task, or platform side effect.

define('RHYTHMJOY_SYNC_ADMIN_LIBRARY_ONLY', true);
require dirname(__DIR__) . '/www/sync-admin/api.php';

function idempotency_test_assert($condition, $message) {
    if (!$condition) {
        throw new RuntimeException('idempotency self-test failed: ' . $message);
    }
}

$env_path = getenv('RHYTHMJOY_ENV_FILE');
if (!$env_path) {
    $env_path = dirname(__DIR__) . '/.env';
}
$env = read_env_file($env_path);
$pdo = db_connect($env);
$database = require_env($env, 'DB_NAME');
if (!preg_match('/^[A-Za-z0-9_]+$/', $database)) {
    throw new RuntimeException('unsafe database name for temporary-table self-test');
}

$tables = array(
    'rhythmjoy_booking_ledger',
    'rhythmjoy_admin_series',
    'rhythmjoy_admin_reservations',
    'rhythmjoy_admin_sync_tasks',
    'rhythmjoy_admin_platform_audits',
    'rhythmjoy_reflection_audits',
);
foreach ($tables as $table) {
    $stmt = $pdo->query("SHOW CREATE TABLE `$database`.`$table`");
    $definition = $stmt->fetch(PDO::FETCH_ASSOC);
    $create_sql = isset($definition['Create Table']) ? $definition['Create Table'] : '';
    if ($create_sql === '') {
        throw new RuntimeException('could not read table definition for ' . $table);
    }
    $create_sql = preg_replace('/^CREATE TABLE /', 'CREATE TEMPORARY TABLE ', $create_sql, 1);
    $pdo->exec($create_sql);
}

$pdo->exec('ALTER TABLE rhythmjoy_admin_platform_audits MODIFY detail_json TEXT NULL');
$pdo->exec('ALTER TABLE rhythmjoy_reflection_audits MODIFY detail_json TEXT NULL');
ensure_column_type($pdo, 'rhythmjoy_admin_platform_audits', 'detail_json', 'mediumtext', 'MEDIUMTEXT NULL');
ensure_column_type($pdo, 'rhythmjoy_reflection_audits', 'detail_json', 'mediumtext', 'MEDIUMTEXT NULL');
foreach (array('rhythmjoy_admin_platform_audits', 'rhythmjoy_reflection_audits') as $table) {
    $stmt = $pdo->query("SHOW COLUMNS FROM `$table` LIKE 'detail_json'");
    $column = $stmt->fetch(PDO::FETCH_ASSOC);
    idempotency_test_assert(strtolower((string) $column['Type']) === 'mediumtext', $table . ' detail evidence migrates without the TEXT limit');
}

$uppercase_admin_event = admin_event_payload(
    999,
    '2098-01-09',
    'A',
    12,
    16,
    'B홀a로이전',
    '',
    ''
);
$admin_naver_payload = admin_live_task_payload('upload', $uppercase_admin_event);
$admin_spacecloud_payload = admin_live_task_payload('naver_block', $uppercase_admin_event);
idempotency_test_assert(
    $admin_naver_payload['ledger_key'] === booking_ledger_key_for_admin('naver', $uppercase_admin_event, 'Ahall'),
    'admin Naver-source task carries the exact ledger key created by PHP'
);
idempotency_test_assert(
    $admin_spacecloud_payload['ledger_key'] === booking_ledger_key_for_admin('spacecloud', $uppercase_admin_event, 'Ahall'),
    'admin SpaceCloud-source task carries the exact case-normalized ledger key created by PHP'
);
idempotency_test_assert(
    $admin_spacecloud_payload['ledger_source_platform'] === 'spacecloud',
    'admin Naver-block task records its ledger source platform explicitly'
);

$test_env = $env;
$test_env['SYNC_ADMIN_ENQUEUE_LIVE_TASKS'] = '0';

$single = array(
    'requestId' => 'selftest-single-request',
    'date' => '2098-01-10',
    'room' => 'C',
    'start' => 13,
    'end' => 15,
    'name' => '단건 자체검사',
    'phone' => '010-0000-1234',
    'memo' => '응답 유실 재시도',
);
$single_first = create_reservation($pdo, $single, $test_env);
$single_retry = create_reservation($pdo, $single, $test_env);
idempotency_test_assert(intval($single_first['createdCount']) === 1 && !$single_first['duplicateRequest'], 'first single request is created once');
idempotency_test_assert(intval($single_retry['createdCount']) === 0 && $single_retry['duplicateRequest'], 'same single request is returned as an idempotent retry');

$single_changed_rejected = false;
try {
    $changed = $single;
    $changed['start'] = 14;
    create_reservation($pdo, $changed, $test_env);
} catch (InvalidArgumentException $error) {
    $single_changed_rejected = true;
}
idempotency_test_assert($single_changed_rejected, 'changed single payload cannot reuse a request id');

$recurring = array(
    'requestId' => 'selftest-recurring-request',
    'title' => '월요일 자체검사',
    'name' => '정기 자체검사',
    'phone' => '',
    'memo' => '응답 유실 재시도',
    'startDate' => '2098-02-01',
    'endDate' => '2098-02-28',
    'fifthWeekPolicy' => 'include',
    'rules' => array(
        array('weekday' => 1, 'room' => 'D', 'start' => 16, 'end' => 17),
    ),
);
$recurring_first = create_recurring_reservations($pdo, $recurring, $test_env);
$recurring_retry = create_recurring_reservations($pdo, $recurring, $test_env);
idempotency_test_assert(intval($recurring_first['createdCount']) > 0 && !$recurring_first['duplicateRequest'], 'first recurring request creates occurrences');
idempotency_test_assert(intval($recurring_retry['createdCount']) === 0 && $recurring_retry['duplicateRequest'], 'same recurring request is returned before self-conflict evaluation');

$recurring_changed_rejected = false;
try {
    $changed = $recurring;
    $changed['rules'][0]['end'] = 18;
    create_recurring_reservations($pdo, $changed, $test_env);
} catch (InvalidArgumentException $error) {
    $recurring_changed_rejected = true;
}
idempotency_test_assert($recurring_changed_rejected, 'changed recurring payload cannot reuse a request id');

$reservation_count = intval($pdo->query('SELECT COUNT(*) FROM rhythmjoy_admin_reservations')->fetchColumn());
$task_count = intval($pdo->query('SELECT COUNT(*) FROM rhythmjoy_admin_sync_tasks')->fetchColumn());
$expected_reservations = 1 + intval($recurring_first['createdCount']);
idempotency_test_assert($reservation_count === $expected_reservations, 'retries do not add reservation rows');
idempotency_test_assert($task_count === $expected_reservations * 2, 'each created reservation has exactly two admin task rows');

$cancel_result = cancel_admin_reservations($pdo, array(
    'reservationIds' => array(intval($single_first['reservationId'])),
    'scope' => 'selected',
), $test_env);
idempotency_test_assert(intval($cancel_result['requestedCount']) === 1, 'single cancellation targets one reservation');
idempotency_test_assert(
    $cancel_result['reservationIds'] === array(intval($single_first['reservationId'])),
    'cancellation returns the exact reservation id for status tracking'
);
$canceled_status_stmt = $pdo->prepare('SELECT status FROM rhythmjoy_admin_reservations WHERE id=?');
$canceled_status_stmt->execute(array(intval($single_first['reservationId'])));
idempotency_test_assert($canceled_status_stmt->fetchColumn() === 'canceled', 'dry-run cancellation reaches its terminal reservation state');
$cancel_operation = admin_reservation_operation_payload($pdo, intval($single_first['reservationId']));
idempotency_test_assert($cancel_operation['operationType'] === 'cancellation', 'canceled reservation exposes cancellation operation tracking');
idempotency_test_assert(count($cancel_operation['tasks']) === 2, 'cancellation operation exposes both platform tasks');
$cancel_task_types = array_map(function($task) { return $task['taskType']; }, $cancel_operation['tasks']);
sort($cancel_task_types);
idempotency_test_assert($cancel_task_types === array('delete', 'naver_restore'), 'cancellation tasks use canonical UI task types');

echo "sync-admin MySQL idempotency self-test OK: retries, exact task cardinality, cancellation tracking, MEDIUMTEXT evidence migration\n";
