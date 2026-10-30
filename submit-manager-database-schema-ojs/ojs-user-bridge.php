<?php
/**
 * OJS User Provisioning Bridge for Digitopub
 *
 * Target Deployment: submitmanager.com (OJS Instance)
 *
 * INSTRUCTIONS:
 * 1. Upload this script (`ojs-user-bridge.php`) to the ROOT directory of the `submitmanager.com` OJS installation.
 *    (It MUST sit next to OJS's `index.php`, `config.inc.php`, and `sso_login.php`).
 * 2. Set the OJS_API_KEY environment variable on BOTH the OJS server and the Next.js server to the same secret.
 * 3. Ensure the server's firewall allows inbound HTTPS requests from the Next.js API host.
 *
 * Security: This script uses Bearer token authentication. All requests must include:
 *   Authorization: Bearer <OJS_API_KEY>
 *
 * @module scripts/ojs-user-bridge
 */

// --- CONFIGURATION ---
$isDev = getenv('APP_ENV') === 'development';
ini_set('display_errors', $isDev ? '1' : '0');
ini_set('display_startup_errors', $isDev ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

// --- OJS Role ID Constants (from PKP\security\Role) ---
define('ROLE_ID_SITE_ADMIN', 1);
define('ROLE_ID_MANAGER', 16);
define('ROLE_ID_SUB_EDITOR', 17);
define('ROLE_ID_ASSISTANT', 4097);
define('ROLE_ID_REVIEWER', 4096);
define('ROLE_ID_AUTHOR', 65536);
define('ROLE_ID_READER', 1048576);

// Map Digitopub roles to OJS role_ids
$ROLE_MAP = [
    'author'   => ROLE_ID_AUTHOR,
    'reviewer' => ROLE_ID_REVIEWER,
    'editor'   => ROLE_ID_SUB_EDITOR,
    'reader'   => ROLE_ID_READER,
];

// --- LOAD OJS CONFIG FOR FALLBACKS ---
$configFile = dirname(__FILE__) . '/config.inc.php';
$config = file_exists($configFile) ? parse_ini_file($configFile, true) : [];

// --- REQUEST VALIDATION ---

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

// Validate Bearer token
// Fallback priority: getenv() -> $_ENV[] -> config.inc.php [digitopub][api_key]
$apiKey = getenv('OJS_API_KEY') ?: ($_ENV['OJS_API_KEY'] ?? ($config['digitopub']['api_key'] ?? ''));
if (empty($apiKey)) {
    error_log('[OJS-Bridge] FATAL: OJS_API_KEY environment variable (or config value) is not set.');
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Server misconfiguration: OJS_API_KEY missing']);
    exit;
}

$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (empty($authHeader) || !preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
    http_response_code(401);
    echo json_encode(['success' => false, 'error' => 'Missing or invalid Authorization header']);
    exit;
}

if (!hash_equals($apiKey, $matches[1])) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Invalid API key']);
    exit;
}

// --- PARSE & VALIDATE PAYLOAD ---
$raw = file_get_contents('php://input');
$payload = json_decode($raw, true);

if (!$payload) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid JSON payload']);
    exit;
}

// --- ACTION DISPATCH ---
// A payload without "action" is user provisioning, exactly as before. Every
// other action is listed here explicitly and writes one known OJS setting;
// there is deliberately no generic "set any setting" action.
$action = $payload['action'] ?? 'provision_user';

if ($action === 'set_journal_specialization') {
    bridgeSetJournalSpecialization(bridgeConnect($config), $payload);
    exit;
}

if ($action === 'update_person') {
    bridgeUpdatePerson(bridgeConnect($config), $payload);
    exit;
}

if ($action !== 'provision_user') {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Unknown action']);
    exit;
}

$email     = trim($payload['email'] ?? '');
$firstName = trim($payload['firstName'] ?? '');
$lastName  = trim($payload['lastName'] ?? '');
$country   = trim($payload['country'] ?? '');
$affiliation = trim($payload['affiliation'] ?? '');
$biography = trim($payload['biography'] ?? '');
$orcid     = trim($payload['orcid'] ?? '');
$password    = $payload['password'] ?? null; // Optional: raw password from registration
$role        = strtolower(trim($payload['primaryRole'] ?? 'author'));
$journalPath = trim($payload['journalPath'] ?? '');

if (empty($email) || empty($firstName) || empty($lastName)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing required fields: email, firstName, lastName']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid email address']);
    exit;
}

// --- DATABASE CONNECTION (use extracted config) ---
if (empty($config) || empty($config['database'])) {
    error_log('[OJS-Bridge] FATAL: Failed to parse config.inc.php or [database] section missing.');
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'OJS database configuration error']);
    exit;
}

$dbConfig = $config['database'];
$dbHost = $dbConfig['host'] ?? 'localhost';
$dbPort = intval($dbConfig['port'] ?? 3306);
$dbName = $dbConfig['name'] ?? '';
$dbUser = $dbConfig['username'] ?? '';
$dbPass = $dbConfig['password'] ?? '';

try {
    $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (PDOException $e) {
    error_log('[OJS-Bridge] DB connection failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database connection failed']);
    exit;
}

// --- CHECK FOR EXISTING USER ---
$stmt = $pdo->prepare('SELECT user_id, username FROM users WHERE email = ?');
$stmt->execute([$email]);
$existingUser = $stmt->fetch();

$userId = null;
$username = '';
$statusCode = 201;
$message = 'User provisioned successfully';

if ($existingUser) {
    // We found an existing user. We must proceed to reconcile their journal roles.
    $userId = (int)$existingUser['user_id'];
    $username = $existingUser['username'];
    $statusCode = 200;
    $message = 'User already exists in OJS, roles reconciled';
} else {
    // --- GENERATE USERNAME ---
    $baseUsername = preg_replace('/[^a-z0-9_]/', '', strtolower(explode('@', $email)[0]));
    $baseUsername = substr($baseUsername, 0, 28); // Leave room for suffix
    if (empty($baseUsername)) {
        $baseUsername = 'user';
    }

    $username = $baseUsername;
    $suffix = 1;
    $stmtCheck = $pdo->prepare('SELECT user_id FROM users WHERE username = ?');
    while (true) {
        $stmtCheck->execute([$username]);
        if (!$stmtCheck->fetch()) break;
        $username = $baseUsername . $suffix;
        $suffix++;
        if ($suffix > 999) {
            $username = $baseUsername . '_' . bin2hex(random_bytes(3));
            break;
        }
    }

    // --- GENERATE PASSWORD HASH ---
    if (!empty($password)) {
        $passwordHash = password_hash($password, PASSWORD_BCRYPT);
    } else {
        $randomPass = bin2hex(random_bytes(16));
        $passwordHash = password_hash($randomPass, PASSWORD_BCRYPT);
    }

    // --- INSERT USER (TRANSACTION) ---
    try {
        $pdo->beginTransaction();
        $now = date('Y-m-d H:i:s');
        $stmt = $pdo->prepare('
            INSERT INTO users (username, password, email, country, locales, date_registered, date_validated, disabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ');
        $stmt->execute([
            $username,
            $passwordHash,
            $email,
            $country ?: null,
            '["en"]',  // Default locale
            $now,
            $now,      // Mark as validated
        ]);

        $userId = (int)$pdo->lastInsertId();

        // Insert user_settings (localized profile data)
        $locale = 'en';
        $settings = [
            ['givenName', $firstName],
            ['familyName', $lastName],
        ];

        if (!empty($affiliation)) {
            $settings[] = ['affiliation', $affiliation];
        }
        if (!empty($biography)) {
            $settings[] = ['biography', $biography];
        }
        if (!empty($orcid)) {
            $stmtSetting = $pdo->prepare('INSERT INTO user_settings (user_id, locale, setting_name, setting_value) VALUES (?, \'\', ?, ?)');
            $stmtSetting->execute([$userId, 'orcid', $orcid]);
        }

        $stmtSetting = $pdo->prepare('INSERT INTO user_settings (user_id, locale, setting_name, setting_value) VALUES (?, ?, ?, ?)');
        foreach ($settings as [$name, $value]) {
            $stmtSetting->execute([$userId, $locale, $name, $value]);
        }
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        if ($e->getCode() == '23000' && strpos($e->getMessage(), 'Duplicate entry') !== false) {
            // Check if it's the email that was duplicated (concurrent insert)
            $stmtCheck = $pdo->prepare('SELECT user_id, username FROM users WHERE email = ?');
            $stmtCheck->execute([$email]);
            $reUser = $stmtCheck->fetch();
            if ($reUser) {
                // Resolved concurrent insert on email
                $userId = (int)$reUser['user_id'];
                $username = $reUser['username'];
                $statusCode = 200;
                $message = 'User already exists (race condition resolved), roles reconciled';
            } else {
                // Must be a username collision or other duplicate key
                http_response_code(500);
                echo json_encode(['success' => false, 'error' => 'Data collision during provisioning. Please try again.']);
                exit;
            }
        } else {
            error_log('[OJS-Bridge] Insert failed: ' . $e->getMessage());
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'Failed to provision user']);
            exit;
        }
    }
}

// --- ASSIGN ROLES ---
// Ensure we resolve the explicit target journal since OJS isolates roles by context.
if (empty($journalPath)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing required journalPath parameter to assign roles']);
    exit;
}

$stmtJournal = $pdo->prepare('SELECT journal_id FROM journals WHERE path = ? LIMIT 1');
$stmtJournal->execute([$journalPath]);
$journal = $stmtJournal->fetch();

if (!$journal) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => "Target journal path not found: {$journalPath}"]);
    exit;
}

$contextId = (int)$journal['journal_id'];
$now = date('Y-m-d H:i:s');

if (!isset($ROLE_MAP[$role])) {
    error_log("[OJS-Bridge] WARNING: Unrecognized role '{$role}' requested. Falling back to ROLE_ID_AUTHOR.");
    $targetRoleId = ROLE_ID_AUTHOR;
} else {
    $targetRoleId = $ROLE_MAP[$role];
}
$rolesToAssign = [$targetRoleId];
if ($targetRoleId !== ROLE_ID_READER) {
    $rolesToAssign[] = ROLE_ID_READER;
}

try {
    $pdo->beginTransaction();
    foreach ($rolesToAssign as $roleId) {
        $stmtGroups = $pdo->prepare('
            SELECT user_group_id FROM user_groups
            WHERE role_id = ? AND context_id = ? AND is_default = 1
            LIMIT 1
        ');
        $stmtGroups->execute([$roleId, $contextId]);
        $userGroup = $stmtGroups->fetch();
        
        if (!$userGroup) {
            $stmtGroups = $pdo->prepare('SELECT user_group_id FROM user_groups WHERE role_id = ? AND context_id = ? LIMIT 1');
            $stmtGroups->execute([$roleId, $contextId]);
            $userGroup = $stmtGroups->fetch();
        }
        
        if ($userGroup) {
            $ugId = (int)$userGroup['user_group_id'];
            // Reconcile membership using SELECT 1 to verify existing status
            $stmtCheckMem = $pdo->prepare('SELECT 1 FROM user_user_groups WHERE user_id = ? AND user_group_id = ?');
            $stmtCheckMem->execute([$userId, $ugId]);
            if (!$stmtCheckMem->fetch()) {
                $stmtAssign = $pdo->prepare('INSERT INTO user_user_groups (user_group_id, user_id, date_start) VALUES (?, ?, ?)');
                $stmtAssign->execute([$ugId, $userId, $now]);
            }
        } else {
            error_log("[OJS-Bridge] WARNING: Missing user_group for roleId={$roleId} contextId={$contextId}, skipping assignment for user {$userId}");
        }
    }
    $pdo->commit();
} catch (PDOException $e) {
    $pdo->rollBack();
    error_log('[OJS-Bridge] Role assignment failed: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Failed to assign user roles in context']);
    exit;
}

http_response_code($statusCode);
echo json_encode([
    'success' => true,
    'message' => $message,
    'user_id' => $userId,
    'username' => $username,
]);

// --- ACTION: set_journal_specialization (#234) ---

/**
 * Open a PDO connection from the OJS [database] config, or answer 500 and exit.
 * Same settings as the provisioning connection above.
 */
function bridgeConnect(array $config): PDO
{
    if (empty($config['database'])) {
        error_log('[OJS-Bridge] FATAL: Failed to parse config.inc.php or [database] section missing.');
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'OJS database configuration error']);
        exit;
    }
    $db = $config['database'];
    $host = $db['host'] ?? 'localhost';
    $port = intval($db['port'] ?? 3306);
    $name = $db['name'] ?? '';
    try {
        return new PDO("mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4", $db['username'] ?? '', $db['password'] ?? '', [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    } catch (PDOException $e) {
        error_log('[OJS-Bridge] DB connection failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Database connection failed']);
        exit;
    }
}

/**
 * Store a journal's specialization, chosen in the digitopub dashboard, as the
 * journal setting `digitopubSpecialization` (locale ''). The digitopub theme
 * declares that property and shows it. An empty value removes the setting.
 *
 * Payload: {"action":"set_journal_specialization","journal_id":10,"value":"Dentistry"}
 * Answer:  {"success":true,"journal_id":10,"before":"General Science","after":"Dentistry"}
 */
function bridgeSetJournalSpecialization(PDO $pdo, array $payload): void
{
    $settingName = 'digitopubSpecialization';
    $journalId = filter_var($payload['journal_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $value = $payload['value'] ?? null;

    if ($journalId === false) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'journal_id must be a positive integer']);
        return;
    }
    if ($value !== null && !is_string($value)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'value must be a string or null']);
        return;
    }
    $value = $value === null ? '' : trim($value);
    // journal_settings is utf8mb3: no 4-byte characters. No control characters.
    if (mb_strlen($value) > 100 || preg_match('/[\x{10000}-\x{10FFFF}]|\p{Cc}/u', $value) !== 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'value must be at most 100 plain characters']);
        return;
    }

    $stmt = $pdo->prepare('SELECT journal_id FROM journals WHERE journal_id = ?');
    $stmt->execute([$journalId]);
    if (!$stmt->fetch()) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Journal not found']);
        return;
    }

    try {
        $pdo->beginTransaction();
        $stmt = $pdo->prepare("SELECT setting_value FROM journal_settings WHERE journal_id = ? AND locale = '' AND setting_name = ? FOR UPDATE");
        $stmt->execute([$journalId, $settingName]);
        $row = $stmt->fetch();
        $before = $row ? $row['setting_value'] : null;

        if ($value === '') {
            $pdo->prepare("DELETE FROM journal_settings WHERE journal_id = ? AND locale = '' AND setting_name = ?")
                ->execute([$journalId, $settingName]);
        } else {
            $pdo->prepare("INSERT INTO journal_settings (journal_id, locale, setting_name, setting_value) VALUES (?, '', ?, ?)
                           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)")
                ->execute([$journalId, $settingName, $value]);
        }
        $pdo->commit();
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[OJS-Bridge] set_journal_specialization failed: ' . $e->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to save journal specialization']);
        return;
    }

    http_response_code(200);
    // INVALID_UTF8_SUBSTITUTE: a legacy invalid value in `before` must not
    // turn a committed write into an empty 200 (which the caller would retry).
    echo json_encode([
        'success' => true,
        'journal_id' => $journalId,
        'before' => $before,
        'after' => $value === '' ? null : $value,
    ], JSON_INVALID_UTF8_SUBSTITUTE);
}

// --- ACTION: update_person (#233) ---

/**
 * Edit one person's name, email and ORCID iD everywhere OJS stores them: the
 * account (users / user_settings), if there is one, and every publication
 * byline (authors / author_settings) with the same email. The person is the
 * email, compared case-insensitively (the columns are *_general_ci).
 *
 * Payload: {"action":"update_person","match_email":"a@x.org",
 *           "givenName"?:"…","familyName"?:"…","email"?:"b@x.org",
 *           "orcid"?:"0000-0002-1825-0097"|null,"dry_run"?:true}
 * Answer:  {"success":true,"dry_run":false,"account":{"user_id":7}|null,
 *           "bylines":3,"publications":2,"changed_publications":2,
 *           "dois_marked_stale":1,"before":{…},"after":{…},"warnings":[]}
 *
 * One transaction. An email or ORCID iD that already belongs to someone else
 * is refused (409), never merged. Publication DOIs whose byline changed are
 * marked stale (status 2/3 -> 5), as OJS's own DoiDAO::markStale does, so
 * Crossref gets the new metadata. dry_run does all of it, then rolls back.
 */
function bridgeUpdatePerson(PDO $pdo, array $payload): void
{
    $fail = function (int $status, string $error, ?string $code = null): void {
        http_response_code($status);
        echo json_encode(['success' => false, 'error' => $error, 'code' => $code]);
    };

    $matchEmail = is_string($payload['match_email'] ?? null) ? trim($payload['match_email']) : '';
    if ($matchEmail === '' || !filter_var($matchEmail, FILTER_VALIDATE_EMAIL)) {
        $fail(400, 'match_email must be a valid email address', 'invalid_input');
        return;
    }
    $dryRun = ($payload['dry_run'] ?? false) === true;

    $changes = [];
    foreach (['givenName', 'familyName'] as $field) {
        if (!array_key_exists($field, $payload)) {
            continue;
        }
        $value = is_string($payload[$field]) ? trim($payload[$field]) : null;
        // Settings tables are utf8mb3: no 4-byte characters. No control characters.
        // preg_match returns false on invalid UTF-8, which is refused too.
        if ($value === null || mb_strlen($value) > 255
            || preg_match('/[\x{10000}-\x{10FFFF}]|\p{Cc}/u', $value) !== 0
            || ($field === 'givenName' && $value === '')) {
            $fail(400, "{$field} must be 1-255 plain characters", 'invalid_input');
            return;
        }
        $changes[$field] = $value;
    }
    if (array_key_exists('email', $payload)) {
        $email = is_string($payload['email']) ? trim($payload['email']) : '';
        // authors.email is varchar(90), shorter than users.email (255).
        if ($email === '' || strlen($email) > 90 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $fail(400, 'email must be a valid email address of at most 90 characters', 'invalid_input');
            return;
        }
        $changes['email'] = $email;
    }
    if (array_key_exists('orcid', $payload)) {
        $raw = $payload['orcid'];
        if ($raw === null || $raw === '') {
            $changes['orcid'] = null;
        } else {
            $orcid = is_string($raw) ? bridgeNormalizeOrcid($raw) : null;
            if ($orcid === null) {
                $fail(400, 'orcid must be a valid ORCID iD', 'invalid_orcid');
                return;
            }
            $changes['orcid'] = $orcid;
        }
    }
    if (!$changes && !$dryRun) {
        $fail(400, 'Nothing to change', 'invalid_input');
        return;
    }

    $names = ['givenName', 'familyName', 'orcid', 'preferredPublicName'];
    $in = implode(',', array_fill(0, count($names), '?'));

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare('SELECT user_id, email FROM users WHERE email = ? FOR UPDATE');
        $stmt->execute([$matchEmail]);
        $account = $stmt->fetch() ?: null;

        $stmt = $pdo->prepare('SELECT author_id, publication_id, email FROM authors WHERE email = ? ORDER BY author_id FOR UPDATE');
        $stmt->execute([$matchEmail]);
        $bylines = $stmt->fetchAll();

        if (!$account && !$bylines) {
            $pdo->rollBack();
            $fail(404, 'No OJS account or byline has this email', 'not_found');
            return;
        }

        // Current settings, as [id][setting_name][locale] => value.
        $accountSettings = [];
        if ($account) {
            $stmt = $pdo->prepare("SELECT setting_name, locale, setting_value FROM user_settings WHERE user_id = ? AND setting_name IN ($in) FOR UPDATE");
            $stmt->execute(array_merge([(int)$account['user_id']], $names));
            foreach ($stmt->fetchAll() as $r) {
                $accountSettings[$r['setting_name']][$r['locale']] = $r['setting_value'];
            }
        }
        $bylineSettings = [];
        if ($bylines) {
            $ids = array_map(fn ($b) => (int)$b['author_id'], $bylines);
            $idIn = implode(',', array_fill(0, count($ids), '?'));
            $stmt = $pdo->prepare("SELECT author_id, setting_name, locale, setting_value FROM author_settings WHERE author_id IN ($idIn) AND setting_name IN ($in) FOR UPDATE");
            $stmt->execute(array_merge($ids, $names));
            foreach ($stmt->fetchAll() as $r) {
                $bylineSettings[(int)$r['author_id']][$r['setting_name']][$r['locale']] = $r['setting_value'];
            }
        }

        // "before" describes the account when there is one, else the first byline.
        $source = $account ? $accountSettings : $bylineSettings[(int)$bylines[0]['author_id']] ?? [];
        $before = [
            'givenName' => bridgeFirstValue($source['givenName'] ?? []),
            'familyName' => bridgeFirstValue($source['familyName'] ?? []),
            'email' => $account ? $account['email'] : $bylines[0]['email'],
            'orcid' => bridgeFirstValue($source['orcid'] ?? []),
        ];
        $after = array_merge($before, $changes);

        // Refuse an email or ORCID iD that already belongs to a different person.
        if (isset($changes['email']) && strcasecmp($changes['email'], $matchEmail) !== 0) {
            $stmt = $pdo->prepare('SELECT (SELECT COUNT(*) FROM users WHERE email = ?) + (SELECT COUNT(*) FROM authors WHERE email = ?) AS n');
            $stmt->execute([$changes['email'], $changes['email']]);
            if ((int)$stmt->fetch()['n'] > 0) {
                $pdo->rollBack();
                $fail(409, 'This email already belongs to another OJS account or author', 'email_in_use');
                return;
            }
        }
        if (!empty($changes['orcid'])) {
            $stmt = $pdo->prepare("SELECT
                (SELECT COUNT(*) FROM author_settings s JOIN authors a ON a.author_id = s.author_id
                  WHERE s.setting_name = 'orcid' AND s.setting_value = ? AND a.email <> ?)
              + (SELECT COUNT(*) FROM user_settings s JOIN users u ON u.user_id = s.user_id
                  WHERE s.setting_name = 'orcid' AND s.setting_value = ? AND u.email <> ?) AS n");
            $stmt->execute([$changes['orcid'], $matchEmail, $changes['orcid'], $matchEmail]);
            if ((int)$stmt->fetch()['n'] > 0) {
                $pdo->rollBack();
                $fail(409, 'This ORCID iD already belongs to another OJS account or author', 'orcid_in_use');
                return;
            }
        }

        $warnings = [];
        $publicNames = 0;

        if ($account) {
            $userId = (int)$account['user_id'];
            if (isset($changes['email']) && $changes['email'] !== $account['email']) {
                $pdo->prepare('UPDATE users SET email = ? WHERE user_id = ?')->execute([$changes['email'], $userId]);
            }
            bridgeApplySettings($pdo, 'user_settings', 'user_id', $userId, $accountSettings, $changes);
            if (bridgeFirstValue($accountSettings['preferredPublicName'] ?? []) !== null) {
                $publicNames++;
            }
        }

        $changedPublications = [];
        foreach ($bylines as $b) {
            $authorId = (int)$b['author_id'];
            $settings = $bylineSettings[$authorId] ?? [];
            $changed = false;
            if (isset($changes['email']) && $changes['email'] !== $b['email']) {
                $pdo->prepare('UPDATE authors SET email = ? WHERE author_id = ?')->execute([$changes['email'], $authorId]);
                $changed = true;
            }
            $changed = bridgeApplySettings($pdo, 'author_settings', 'author_id', $authorId, $settings, $changes) || $changed;
            if ($changed) {
                $changedPublications[(int)$b['publication_id']] = true;
            }
            if (bridgeFirstValue($settings['preferredPublicName'] ?? []) !== null) {
                $publicNames++;
            }
        }
        if ($publicNames > 0 && (isset($changes['givenName']) || isset($changes['familyName']))) {
            $warnings[] = "A preferred public name is set on {$publicNames} record(s); OJS shows it instead of the given/family name.";
        }

        $staleDois = 0;
        if ($changedPublications) {
            $pubIds = array_keys($changedPublications);
            $pubIn = implode(',', array_fill(0, count($pubIds), '?'));
            // Doi::STATUS_SUBMITTED (2) / STATUS_REGISTERED (3) -> STATUS_STALE (5).
            $stmt = $pdo->prepare("UPDATE dois d JOIN publications p ON p.doi_id = d.doi_id
                                   SET d.status = 5 WHERE p.publication_id IN ($pubIn) AND d.status IN (2, 3)");
            $stmt->execute($pubIds);
            $staleDois = $stmt->rowCount();
        }

        if ($dryRun) {
            $pdo->rollBack();
        } else {
            $pdo->commit();
        }
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        // users.email is unique: a concurrent insert of the new address lands here.
        if ($e->getCode() == '23000') {
            $fail(409, 'This email already belongs to another OJS account', 'email_in_use');
            return;
        }
        error_log('[OJS-Bridge] update_person failed: ' . $e->getMessage());
        $fail(500, 'Failed to update the person in OJS', 'server_error');
        return;
    }

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'dry_run' => $dryRun,
        'account' => $account ? ['user_id' => (int)$account['user_id']] : null,
        'bylines' => count($bylines),
        'publications' => count(array_unique(array_map(fn ($b) => (int)$b['publication_id'], $bylines))),
        'changed_publications' => count($changedPublications),
        'dois_marked_stale' => $staleDois,
        'before' => $before,
        'after' => $after,
        'warnings' => $warnings,
    ], JSON_INVALID_UTF8_SUBSTITUTE);
}

/**
 * Write the requested name/ORCID changes into one record's settings rows.
 * Names are updated in every locale the record already has (a missing name
 * is added in the record's own locale); the ORCID iD lives in locale ''.
 * Returns whether any row changed.
 */
function bridgeApplySettings(PDO $pdo, string $table, string $idColumn, int $id, array $settings, array $changes): bool
{
    $changed = false;
    $upsert = $pdo->prepare("INSERT INTO {$table} ({$idColumn}, locale, setting_name, setting_value) VALUES (?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)");
    $defaultLocale = array_key_first($settings['givenName'] ?? []) ?? array_key_first($settings['familyName'] ?? []) ?? 'en';

    foreach (['givenName', 'familyName'] as $field) {
        if (!array_key_exists($field, $changes)) {
            continue;
        }
        $locales = $settings[$field] ?? [$defaultLocale => null];
        foreach ($locales as $locale => $current) {
            if ($current !== $changes[$field]) {
                $upsert->execute([$id, (string)$locale, $field, $changes[$field]]);
                $changed = true;
            }
        }
    }

    if (array_key_exists('orcid', $changes)) {
        $current = $settings['orcid'] ?? [];
        if ($changes['orcid'] === null) {
            if ($current) {
                $pdo->prepare("DELETE FROM {$table} WHERE {$idColumn} = ? AND setting_name = 'orcid'")->execute([$id]);
                $changed = true;
            }
        } elseif (array_values($current) !== [$changes['orcid']] || array_keys($current) !== ['']) {
            $pdo->prepare("DELETE FROM {$table} WHERE {$idColumn} = ? AND setting_name = 'orcid'")->execute([$id]);
            $upsert->execute([$id, '', 'orcid', $changes['orcid']]);
            $changed = true;
        }
    }
    return $changed;
}

/** First non-empty value of a [locale => value] map, or null. */
function bridgeFirstValue(array $byLocale): ?string
{
    foreach ($byLocale as $value) {
        if ($value !== null && $value !== '') {
            return $value;
        }
    }
    return null;
}

/**
 * "0000-0002-1825-0097" or "https://orcid.org/0000-0002-1825-0097" ->
 * "https://orcid.org/0000-0002-1825-0097" (the form OJS stores), or null when
 * the format or the ISO 7064 MOD 11-2 check digit is wrong.
 */
function bridgeNormalizeOrcid(string $raw): ?string
{
    $id = strtoupper(preg_replace('#^https?://(www\.)?orcid\.org/#i', '', trim($raw)));
    if (!preg_match('/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/', $id)) {
        return null;
    }
    $digits = str_replace('-', '', $id);
    $total = 0;
    for ($i = 0; $i < 15; $i++) {
        $total = ($total + (int)$digits[$i]) * 2;
    }
    $check = (12 - $total % 11) % 11;
    $expected = $check === 10 ? 'X' : (string)$check;
    return $digits[15] === $expected ? 'https://orcid.org/' . $id : null;
}
