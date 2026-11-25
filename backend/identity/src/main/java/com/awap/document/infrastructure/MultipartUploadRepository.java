package com.awap.document.infrastructure;

import com.awap.document.domain.MultipartUpload;
import com.awap.document.domain.MultipartUploadStatus;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for resumable uploads; every lookup is tenant-scoped. */
public interface MultipartUploadRepository extends JpaRepository<MultipartUpload, UUID> {

  Optional<MultipartUpload> findByUploadIdAndTenantId(UUID uploadId, UUID tenantId);

  List<MultipartUpload> findByStatusInAndExpiresAtBefore(
      Collection<MultipartUploadStatus> statuses, Instant cutoff);
}
