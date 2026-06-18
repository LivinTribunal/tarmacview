// matches backend/app/schemas/field_link.py

export interface FieldLinkDevice {
  sn: string;
  model_name: string | null;
  model_key: string | null;
  domain: number | null;
  online: boolean;
  bound: boolean;
  gateway_sn: string | null;
}

export interface FieldLinkStatusResponse {
  hub_online: boolean;
  // pilot's http session is live (RC connected); separate from broker_connected
  // (hub<->broker link) and from a drone being online over MQTT (devices[].online)
  rc_connected: boolean;
  broker_connected: boolean;
  devices: FieldLinkDevice[];
  connect_url: string | null;
  public_host: string | null;
}

// matches backend/app/schemas/wayline_dispatch.py
export interface WaylineDispatchResponse {
  id: string;
  mission_id: string;
  wayline_id: string;
  device_sn: string | null;
  status: string;
  dispatched_at: string;
}
