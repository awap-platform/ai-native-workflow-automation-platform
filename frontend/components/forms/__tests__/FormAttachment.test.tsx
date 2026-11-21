import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import FormAttachment from "../FormAttachment";

function renderAttachment(scanStatus: string | null, overrides: Partial<Parameters<typeof FormAttachment>[0]> = {}) {
  const downloader = jest.fn(async () => ({ downloadUrl: "https://minio/promoted/contract.pdf" }));
  const open = jest.fn();
  render(
    <FormAttachment
      fileId="file-1"
      name="contract.pdf"
      scanStatus={scanStatus}
      size={4096}
      downloader={downloader}
      open={open}
      {...overrides}
    />,
  );
  return { downloader, open };
}

describe("T6-05 PROMOTED files are downloadable", () => {
  it("creates a download link and opens it", async () => {
    const { downloader, open } = renderAttachment("PROMOTED");
    const button = screen.getByRole("button", { name: "Download contract.pdf" });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() => expect(open).toHaveBeenCalledWith("https://minio/promoted/contract.pdf"));
    expect(downloader).toHaveBeenCalledWith("file-1");
  });

  it("reports a failed link without crashing", async () => {
    const downloader = jest.fn(async () => {
      throw new Error("offline");
    });
    render(
      <FormAttachment
        fileId="file-1"
        name="contract.pdf"
        scanStatus="PROMOTED"
        downloader={downloader}
        open={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download contract.pdf" }));
    expect(await screen.findByText(/could not be created/)).toBeInTheDocument();
  });
});

describe("T6-06 INFECTED files are blocked", () => {
  it("disables the download and never calls the endpoint", () => {
    const { downloader } = renderAttachment("INFECTED");
    const button = screen.getByRole("button", { name: "Download unavailable" });
    expect(button).toBeDisabled();
    expect(screen.getByText(/failed the antivirus scan/)).toBeInTheDocument();

    fireEvent.click(button);
    expect(downloader).not.toHaveBeenCalled();
  });

  it("keeps a pending file disabled until promotion", () => {
    renderAttachment("QUARANTINED");
    expect(screen.getByRole("button", { name: "Download unavailable" })).toBeDisabled();
    expect(screen.getByText(/becomes downloadable/)).toBeInTheDocument();
  });
});
