const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
admin.initializeApp();

// Must match the SUPER_ADMIN constant in zel-app.html
const SUPER_ADMIN = "zhakeel.mhd@gmail.com";

/**
 * Callable function: adminResetPassword
 * Lets a signed-in admin directly set a NEW password for a student account,
 * with no email involved. Only callable by:
 *   - the SUPER_ADMIN account, or
 *   - any Firestore doc at admins/{callerEmail}
 * Data expected: { uid: string, newPassword: string }
 */
exports.adminResetPassword = onCall(async (request) => {
  const auth = request.auth;
  if (!auth || !auth.token || !auth.token.email) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerEmail = auth.token.email;
  let isAdmin = callerEmail === SUPER_ADMIN;
  if (!isAdmin) {
    const adminDoc = await admin.firestore().doc(`admins/${callerEmail}`).get();
    isAdmin = adminDoc.exists;
  }
  if (!isAdmin) {
    throw new HttpsError("permission-denied", "Only admins can reset student passwords.");
  }

  const { uid, newPassword } = request.data || {};
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "A student UID is required.");
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "New password must be at least 6 characters.");
  }

  // Make sure the target account is actually a student, not silently letting
  // an admin overwrite an arbitrary/unrelated Auth account by UID.
  const studentDoc = await admin.firestore().doc(`students/${uid}`).get();
  if (!studentDoc.exists) {
    throw new HttpsError("not-found", "No student record found for this account.");
  }

  try {
    await admin.auth().updateUser(uid, { password: newPassword });
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      throw new HttpsError(
        "not-found",
        `This student's login account (${uid}) no longer exists in Firebase Authentication, ` +
        `even though their student record does. It may have been deleted separately, or never ` +
        `fully created. Ask the student to Register again with the same email, or contact support.`
      );
    }
    throw new HttpsError("internal", `Password update failed: ${e.message || e.code || "unknown error"}`);
  }

  return { success: true };
});

/**
 * Callable function: adminRecreateStudentAuth
 * Repairs a student whose Firestore profile still exists but whose Firebase
 * Auth account was deleted separately (e.g. removed manually in the
 * Console). Recreates the Auth account under the SAME uid as the Firestore
 * doc, so all existing attendance/fee records (keyed by that uid) stay
 * correctly linked — nothing needs to be re-entered.
 * Data expected: { uid: string, newPassword: string }
 */
exports.adminRecreateStudentAuth = onCall(async (request) => {
  const auth = request.auth;
  if (!auth || !auth.token || !auth.token.email) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const callerEmail = auth.token.email;
  let isAdmin = callerEmail === SUPER_ADMIN;
  if (!isAdmin) {
    const adminDoc = await admin.firestore().doc(`admins/${callerEmail}`).get();
    isAdmin = adminDoc.exists;
  }
  if (!isAdmin) {
    throw new HttpsError("permission-denied", "Only admins can repair student logins.");
  }

  const { uid, newPassword } = request.data || {};
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "A student UID is required.");
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "New password must be at least 6 characters.");
  }

  const studentDoc = await admin.firestore().doc(`students/${uid}`).get();
  if (!studentDoc.exists) {
    throw new HttpsError("not-found", "No student record found for this account.");
  }
  const email = studentDoc.data().email;
  if (!email) {
    throw new HttpsError("failed-precondition", "This student record has no email on file, so a login can't be recreated for it.");
  }

  // Safety check: only proceed if no live Auth account already exists under this uid.
  let accountExists = true;
  try {
    await admin.auth().getUser(uid);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      accountExists = false;
    } else {
      throw new HttpsError("internal", `Could not verify account status: ${e.message || e.code}`);
    }
  }
  if (accountExists) {
    throw new HttpsError("failed-precondition", "This account already exists — no repair needed. Use Reset Password instead.");
  }

  try {
    await admin.auth().createUser({ uid, email, password: newPassword, emailVerified: false });
  } catch (e) {
    throw new HttpsError("internal", `Could not recreate account: ${e.message || e.code || "unknown error"}`);
  }

  return { success: true, email };
});
