package dev.remotepi.android.core;

import org.junit.Test;
import static org.junit.Assert.*;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okio.Buffer;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.*;

public class FilePreviewCacheTest {
    private static final String PATH = "/api/machines/local/projects/p/workspaces/w/file/preview?path=test.xlsx&download=1";
    @Test public void downloadsExactBytesAndRemovesCacheOnRelease() throws Exception {
        File directory = Files.createTempDirectory("preview-test-").toFile();
        try (MockWebServer server = new MockWebServer()) {
            byte[] bytes = new byte[] { 0, 1, -1, 42 };
            server.enqueue(new MockResponse().setBody(new Buffer().write(bytes))); server.start();
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> {});
            FilePreviewCache cache = new FilePreviewCache(directory);
            String id = UUID.randomUUID().toString();
            try {
                File file = cache.begin(transport, id, PATH, 1024).read();
                assertArrayEquals(bytes, Files.readAllBytes(file.toPath())); assertEquals(PATH, server.takeRequest().getPath());
                cache.release("different-id"); assertTrue(file.exists());
                cache.release(id); assertFalse(file.exists());
            } finally { cache.clear(); transport.disconnect(); }
        } finally { directory.delete(); }
    }
    @Test public void refusesOversizeChunksRedirectsAndInvalidRequests() throws Exception {
        File directory = Files.createTempDirectory("preview-test-").toFile();
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setChunkedBody(new Buffer().write(new byte[2048]), 256));
            server.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", "https://example.com")); server.start();
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> {});
            FilePreviewCache cache = new FilePreviewCache(directory);
            try {
                assertThrows(IOException.class, () -> cache.begin(transport, UUID.randomUUID().toString(), PATH, 1024).read());
                assertEquals(0, directory.list().length);
                assertThrows(IOException.class, () -> cache.begin(transport, UUID.randomUUID().toString(), PATH, 1024).read());
                assertThrows(IllegalArgumentException.class, () -> cache.begin(transport, "../bad", PATH, 1024));
                assertThrows(IllegalArgumentException.class, () -> cache.begin(transport, UUID.randomUUID().toString(), "https://example.com", 1024));
                assertThrows(IllegalArgumentException.class, () -> cache.begin(transport, UUID.randomUUID().toString(), PATH, 129L * 1024 * 1024));
            } finally { cache.clear(); transport.disconnect(); }
        } finally { directory.delete(); }
    }
    @Test public void cancellationInterruptsPendingDownloadAndDeletesPartialFile() throws Exception {
        File directory = Files.createTempDirectory("preview-test-").toFile();
        ExecutorService workers = Executors.newSingleThreadExecutor();
        try (MockWebServer server = new MockWebServer()) {
            server.enqueue(new MockResponse().setBody(new Buffer().write(new byte[16384])).throttleBody(256, 100, TimeUnit.MILLISECONDS)); server.start();
            PiTransport transport = new PiTransport(() -> server.url("/").toString().replaceAll("/$", ""), (id, type, data) -> {});
            FilePreviewCache cache = new FilePreviewCache(directory); String id = UUID.randomUUID().toString();
            try {
                FilePreviewCache.Download task = cache.begin(transport, id, PATH, 20000);
                Future<File> result = workers.submit(task::read);
                assertNotNull(server.takeRequest(5, TimeUnit.SECONDS)); cache.release(id);
                assertThrows(ExecutionException.class, () -> result.get(5, TimeUnit.SECONDS));
                assertEquals(0, directory.list().length);
            } finally { cache.clear(); transport.disconnect(); }
        } finally { workers.shutdownNow(); directory.delete(); }
    }
}
