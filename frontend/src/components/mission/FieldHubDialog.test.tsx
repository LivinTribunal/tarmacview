import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FieldHubDialog from "./FieldHubDialog";
import { downloadCaCert } from "@/api/fieldLink";
import type {
  FieldLinkDevice,
  FieldLinkStatusResponse,
} from "@/types/fieldLink";

vi.mock("@/api/fieldLink", () => ({
  downloadCaCert: vi.fn(),
}));

const mockedDownloadCa = vi.mocked(downloadCaCert);

const M350: FieldLinkDevice = {
  sn: "1ZNBJ7R0010078",
  model_name: "Matrice 350 RTK",
  model_key: "0-89-0",
  domain: 0,
  online: true,
  bound: true,
  gateway_sn: "5YSZK1400B00A1",
};

const ONLINE: FieldLinkStatusResponse = {
  hub_online: true,
  rc_connected: true,
  broker_connected: true,
  connect_url: "http://192.168.8.50:8080",
  public_host: "192.168.8.50",
  devices: [M350],
};

const OFFLINE: FieldLinkStatusResponse = {
  hub_online: false,
  rc_connected: false,
  broker_connected: false,
  connect_url: null,
  public_host: null,
  devices: [],
};

const NO_HOST: FieldLinkStatusResponse = {
  hub_online: true,
  rc_connected: true,
  broker_connected: true,
  connect_url: null,
  public_host: null,
  devices: [],
};

function renderDialog(
  overrides: Partial<Parameters<typeof FieldHubDialog>[0]> = {},
) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    status: ONLINE,
    ...overrides,
  };
  return { ...render(<FieldHubDialog {...props} />), props };
}

beforeEach(() => {
  mockedDownloadCa.mockReset();
});

describe("FieldHubDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ isOpen: false });

    expect(screen.queryByTestId("field-hub-dialog")).toBeNull();
  });

  it("shows the connect address, an inline QR, and the device list when online", () => {
    renderDialog();

    expect(screen.getByTestId("field-hub-connect-url").textContent).toBe(
      "http://192.168.8.50:8080",
    );
    const qr = screen.getByTestId("field-hub-qr");
    expect(qr.querySelector("path")?.getAttribute("d")).toBeTruthy();
    expect(screen.getByTestId("field-hub-status")).toHaveAttribute(
      "data-online",
      "true",
    );
    const devices = screen.getAllByTestId("field-hub-device");
    expect(devices).toHaveLength(1);
    expect(devices[0].textContent).toContain("Matrice 350 RTK");
  });

  it("copies the connect address to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog();

    fireEvent.click(screen.getByTestId("field-hub-copy-btn"));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("http://192.168.8.50:8080"),
    );
  });

  it("shows the offline troubleshooting hint when the hub is down", () => {
    renderDialog({ status: OFFLINE });

    expect(screen.getByTestId("field-hub-offline")).toBeInTheDocument();
    expect(screen.queryByTestId("field-hub-connect-url")).toBeNull();
    expect(screen.queryByTestId("field-hub-qr")).toBeNull();
    expect(screen.getByTestId("field-hub-status")).toHaveAttribute(
      "data-online",
      "false",
    );
  });

  it("shows the not-configured state when online but no host is set", () => {
    renderDialog({ status: NO_HOST });

    expect(screen.getByTestId("field-hub-no-host")).toBeInTheDocument();
    expect(screen.queryByTestId("field-hub-connect-url")).toBeNull();
  });

  it("renders the empty-device state when no devices are connected", () => {
    renderDialog({ status: NO_HOST });

    expect(screen.getByTestId("field-hub-no-devices")).toBeInTheDocument();
    expect(screen.queryAllByTestId("field-hub-device")).toHaveLength(0);
  });

  it("shows a connecting state before the first poll response", () => {
    renderDialog({ status: null });

    expect(screen.getByTestId("field-hub-connecting")).toBeInTheDocument();
  });

  it("downloads the CA certificate", async () => {
    mockedDownloadCa.mockResolvedValue({
      blob: new Blob(["cert"]),
      filename: "fieldhub-ca.crt",
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    renderDialog();

    fireEvent.click(screen.getByTestId("field-hub-ca-download"));

    await waitFor(() => expect(mockedDownloadCa).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("surfaces a CA download error when the cert is unavailable", async () => {
    mockedDownloadCa.mockRejectedValue(new Error("404"));
    renderDialog();

    fireEvent.click(screen.getByTestId("field-hub-ca-download"));

    await waitFor(() =>
      expect(screen.getByTestId("field-hub-ca-error")).toBeInTheDocument(),
    );
  });
});
