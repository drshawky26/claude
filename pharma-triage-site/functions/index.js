const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

// Facebook Graph API integration (fbSync scheduler + fbRefresh callable).
Object.assign(exports, require("./facebook"));

const ADMIN_EMAIL = "drshawky530@gmail.com";

function normalizeLoginId(loginId) {
  loginId = String(loginId || "").trim();
  if (/^\d+$/.test(loginId)) return `agent${loginId}@pharma.local`;
  if (loginId.includes("@")) return loginId;
  return `${loginId}@pharma.local`;
}

async function assertAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required");
  }
  const email = context.auth.token.email;
  if (email === ADMIN_EMAIL) return true;

  const snap = await admin.firestore().collection("users").doc(context.auth.uid).get();
  if (snap.exists && snap.data().role === "admin" && snap.data().active !== false) return true;

  throw new functions.https.HttpsError("permission-denied", "Admin only");
}

exports.createAppUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const email = normalizeLoginId(data.loginId);
  const password = String(data.password || "");
  const role = data.role || "agent";
  const team = data.team || "callcenter";
  const displayName = data.displayName || data.loginId || email;
  const agentNumber = data.agentNumber || (/agent(\d+)@/.exec(email)?.[1] || "");

  if (!password || password.length < 6) {
    throw new functions.https.HttpsError("invalid-argument", "Password must be at least 6 characters");
  }

  const user = await admin.auth().createUser({
    email,
    password,
    displayName,
    disabled: false
  });

  await admin.firestore().collection("users").doc(user.uid).set({
    uid: user.uid,
    email,
    displayName,
    role,
    team,
    agentNumber,
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: new Date().toISOString(),
    createdBy: context.auth.token.email
  });

  return { uid: user.uid, email };
});

exports.updateAppUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const uid = data.uid;
  if (!uid) throw new functions.https.HttpsError("invalid-argument", "uid required");

  const patch = {
    displayName: data.displayName || "",
    role: data.role || "agent",
    team: data.team || "callcenter",
    active: data.active !== false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: context.auth.token.email
  };

  await admin.firestore().collection("users").doc(uid).set(patch, { merge: true });
  await admin.auth().updateUser(uid, {
    displayName: patch.displayName,
    disabled: patch.active === false
  });

  return { ok: true };
});

exports.deleteAppUser = functions.https.onCall(async (data, context) => {
  await assertAdmin(context);

  const uid = data.uid;
  if (!uid) throw new functions.https.HttpsError("invalid-argument", "uid required");

  await admin.firestore().collection("users").doc(uid).delete();
  await admin.auth().deleteUser(uid);

  return { ok: true };
});
