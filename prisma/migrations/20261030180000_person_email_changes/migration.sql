-- #233: pending author email changes, confirmed by the new address before OJS is written.
CREATE TABLE `person_email_changes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `token_hash` CHAR(64) NOT NULL,
    `old_email` VARCHAR(255) NOT NULL,
    `new_email` VARCHAR(90) NOT NULL,
    `requested_by_admin_id` BIGINT NULL,
    `requested_by_orcid` VARCHAR(19) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `confirmed_at` DATETIME(3) NULL,
    `error` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `person_email_changes_token_hash_key`(`token_hash`),
    INDEX `person_email_changes_old_email_idx`(`old_email`),
    INDEX `person_email_changes_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
