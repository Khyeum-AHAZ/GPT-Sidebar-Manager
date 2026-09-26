(() => {
  "use strict";

  const OLD_PREFIX = "gsm.folder.v1.";
  const NEW_PREFIX = "gsm.folder.v2.";
  const ID = /^[a-zA-Z0-9_-]{8,}$/;

  class Migration {
    static fromLocal(stored) {
      const migrated = {};
      for (const [key, old] of Object.entries(stored)) {
        if (!key.startsWith(OLD_PREFIX)) continue;
        const suffix = key.slice(OLD_PREFIX.length);
        const newKey = `${NEW_PREFIX}${suffix}`;
        if (Object.hasOwn(stored, newKey)) continue;
        if (!old || !ID.test(old.projectId) || !ID.test(old.folderId) ||
            suffix !== `${old.projectId}.${old.folderId}` ||
            typeof old.name !== "string" || !old.name.trim() ||
            !Number.isFinite(old.order) || typeof old.collapsed !== "boolean" ||
            !Number.isFinite(old.updatedAt) ||
            (old.deletedAt !== null && !Number.isFinite(old.deletedAt))) {
          throw new Error("Legacy folder record is invalid");
        }
        // Phase 3 records were local only, so deleted folders never reached Sync.
        if (old.deletedAt !== null) continue;
        migrated[newKey] = { ...old, schemaVersion: 2, revision: 1 };
      }
      return migrated;
    }
  }

  globalThis.GSMMigration = Migration;
  if (typeof module !== "undefined") module.exports = Migration;
})();
