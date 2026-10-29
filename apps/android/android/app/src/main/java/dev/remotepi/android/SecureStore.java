package dev.remotepi.android;

import android.content.Context;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import com.getcapacitor.JSObject;
import dev.remotepi.android.core.SshTunnel;
import org.json.JSONArray;
import org.json.JSONObject;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.*;
import java.security.KeyStore;
import java.util.UUID;

final class SecureStore {
    private static final String KEY_ALIAS = "remote-pi-imported-keys";
    private final Context context;
    SecureStore(Context context) { this.context = context; }
    synchronized JSObject settings() throws Exception { return new JSObject(context.getSharedPreferences("settings", Context.MODE_PRIVATE).getString("json", "{\"profiles\":[],\"theme\":\"light\"}")); }
    static SshTunnel.Options options(JSObject profile) {
        String id = profile.optString("id"); String identity = profile.optString("identityFile");
        if (!id.matches("[a-zA-Z0-9_-]{1,64}") || profile.optString("name").trim().isEmpty() || profile.optString("name").length() > 80) throw new IllegalArgumentException("服务器名称或 ID 无效。");
        if (!identity.isEmpty() && !identity.matches("key:[a-zA-Z0-9-]{36}")) throw new IllegalArgumentException("私钥选择无效，请重新导入。");
        return new SshTunnel.Options(profile.optString("host").trim(), profile.optString("username").trim(), profile.isNull("port") ? 22 : profile.optInt("port", 22), profile.optInt("remotePort", 8504), identity);
    }
    synchronized JSObject saveProfile(JSObject input) throws Exception {
        SshTunnel.Options options = options(input);
        JSObject clean = new JSObject().put("id", input.getString("id")).put("name", input.getString("name").trim()).put("host", options.host).put("username", options.username).put("port", options.port).put("remotePort", options.remotePort).put("identityFile", options.identity);
        JSObject settings = settings(); JSONArray list = settings.getJSONArray("profiles"); JSONArray next = new JSONArray();
        for (int i = 0; i < list.length(); i++) if (!list.getJSONObject(i).getString("id").equals(input.getString("id"))) next.put(list.get(i));
        next.put(clean); settings.put("profiles", next); persist(settings); return clean;
    }
    synchronized void deleteProfile(String id) throws Exception {
        JSObject settings = settings(); JSONArray list = settings.getJSONArray("profiles"); JSONArray next = new JSONArray(); String oldKey = "";
        for (int i = 0; i < list.length(); i++) { JSONObject item = list.getJSONObject(i); if (item.getString("id").equals(id)) oldKey = item.optString("identityFile"); else next.put(item); }
        settings.put("profiles", next); persist(settings);
        boolean referenced = false; for (int i = 0; i < next.length(); i++) if (next.getJSONObject(i).optString("identityFile").equals(oldKey)) referenced = true;
        if (!oldKey.isEmpty() && !referenced) keyFile(oldKey).delete();
    }
    synchronized void setTheme(String theme) throws Exception { if (!theme.equals("light") && !theme.equals("dark")) throw new IllegalArgumentException("主题无效。"); JSObject settings = settings(); settings.put("theme", theme); persist(settings); }
    private void persist(JSObject settings) throws IOException { if (!context.getSharedPreferences("settings", Context.MODE_PRIVATE).edit().putString("json", settings.toString()).commit()) throw new IOException("无法保存配置。"); }
    private SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build()); return generator.generateKey();
    }
    private File keyFile(String identity) { if (!identity.matches("key:[a-zA-Z0-9-]{36}")) throw new IllegalArgumentException("私钥标识无效。"); File directory = new File(context.getFilesDir(), "keys"); directory.mkdirs(); return new File(directory, identity.substring(4)); }
    synchronized String importKey(Uri uri) throws Exception {
        byte[] bytes;
        try (InputStream input = context.getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IOException("无法打开私钥文件。");
            byte[] buffer = new byte[8192]; int read; while ((read = input.read(buffer)) != -1) { if (output.size() + read > 1024 * 1024) throw new IOException("私钥文件不能超过 1 MB。"); output.write(buffer, 0, read); } bytes = output.toByteArray();
        }
        try {
            String text = new String(bytes, java.nio.charset.StandardCharsets.US_ASCII);
            if (!(text.contains("PRIVATE KEY") || text.startsWith("PuTTY-User-Key-File-"))) throw new IllegalArgumentException("请选择 OpenSSH、PEM 或 PuTTY 格式的私钥文件。");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
            String identity = "key:" + UUID.randomUUID();
            try (DataOutputStream output = new DataOutputStream(new FileOutputStream(keyFile(identity)))) { byte[] iv = cipher.getIV(); output.writeInt(iv.length); output.write(iv); output.write(cipher.doFinal(bytes)); }
            return identity;
        } finally { java.util.Arrays.fill(bytes, (byte) 0); }
    }
    synchronized byte[] readKey(String identity) throws Exception {
        if (identity == null || identity.isEmpty()) return null;
        try (DataInputStream input = new DataInputStream(new FileInputStream(keyFile(identity)))) {
            int length = input.readInt(); if (length != 12) throw new IOException("私钥数据无效，请重新导入。"); byte[] iv = new byte[length]; input.readFully(iv);
            ByteArrayOutputStream encrypted = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int read; while ((read = input.read(buffer)) != -1) encrypted.write(buffer, 0, read);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, iv)); return cipher.doFinal(encrypted.toByteArray());
        }
    }
}
