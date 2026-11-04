package dev.remotepi.android.core;

import okhttp3.Call;
import okhttp3.Response;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** One app-private preview at a time; cancellation also removes downloaded bytes. */
public final class FilePreviewCache {
    private final File directory;
    private Download current;
    public FilePreviewCache(File directory) throws IOException {
        this.directory = directory;
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建预览缓存。");
        File[] old = directory.listFiles();
        if (old != null) for (File file : old) if (file.getName().startsWith("preview-")) file.delete();
    }
    public synchronized Download begin(PiTransport transport, String id, String path, long limit) throws IOException {
        if (id == null || !id.matches("[a-fA-F0-9-]{36}")) throw new IllegalArgumentException("预览 ID 无效。");
        if (path == null || !path.matches("/api/machines/local/projects/[^/]+/workspaces/[^/]+/file/preview\\?.*") || !path.contains("download=1")) throw new IllegalArgumentException("预览接口无效。");
        if (limit < 1 || limit > 128L * 1024 * 1024) throw new IllegalArgumentException("预览大小限制无效。");
        clear();
        current = new Download(id, transport.newRequest(path, "GET", null, 120000), File.createTempFile("preview-", ".bin", directory), limit);
        return current;
    }
    public synchronized void release(String id) { if (current != null && current.id.equals(id)) clear(); }
    public synchronized void clear() {
        if (current != null) { current.call.cancel(); current.file.delete(); current = null; }
    }
    public final class Download {
        private final String id;
        private final Call call;
        private final File file;
        private final long limit;
        private Download(String id, Call call, File file, long limit) { this.id = id; this.call = call; this.file = file; this.limit = limit; }
        public File read() throws IOException {
            boolean completed = false;
            try (Response response = call.execute()) {
                if (!response.isSuccessful() || response.body() == null) throw new IOException("无法读取预览文件（HTTP " + response.code() + "）。");
                if (response.body().contentLength() > limit) throw tooLarge();
                if (call.isCanceled()) throw new IOException("预览已取消。");
                try (InputStream input = response.body().byteStream(); FileOutputStream output = new FileOutputStream(file)) {
                    byte[] buffer = new byte[16384]; long length = 0; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (call.isCanceled()) throw new IOException("预览已取消。");
                        length += count; if (length > limit) throw tooLarge();
                        output.write(buffer, 0, count);
                    }
                }
                synchronized (FilePreviewCache.this) {
                    if (current != this || call.isCanceled()) throw new IOException("预览已取消。");
                    completed = true; return file;
                }
            } finally { if (!completed) { call.cancel(); file.delete(); } }
        }
        private IOException tooLarge() { return new IOException("文件过大，此格式最多预览 " + (limit / 1024 / 1024) + " MiB。"); }
    }
}
