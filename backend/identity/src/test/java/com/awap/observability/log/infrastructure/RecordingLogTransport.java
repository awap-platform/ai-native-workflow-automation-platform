package com.awap.observability.log.infrastructure;

import com.awap.analytics.infrastructure.opensearch.OpenSearchResponse;
import com.awap.analytics.infrastructure.opensearch.OpenSearchTransport;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/** Deterministic transport that records requests and replays queued responses or failures. */
final class RecordingLogTransport implements OpenSearchTransport {

  record Request(String method, String path, String body) {}

  private final List<Request> requests = new ArrayList<>();
  private final Deque<Object> responses = new ArrayDeque<>();

  void respondWith(OpenSearchResponse response) {
    responses.add(response);
  }

  void failWith(IOException failure) {
    responses.add(failure);
  }

  void failWith(InterruptedException failure) {
    responses.add(failure);
  }

  List<Request> requests() {
    return requests;
  }

  @Override
  public OpenSearchResponse execute(String method, String path, String body)
      throws IOException, InterruptedException {
    requests.add(new Request(method, path, body));
    Object next = responses.poll();
    if (next instanceof IOException failure) {
      throw failure;
    }
    if (next instanceof InterruptedException failure) {
      throw failure;
    }
    if (next instanceof OpenSearchResponse response) {
      return response;
    }
    return new OpenSearchResponse(200, "{}");
  }
}
