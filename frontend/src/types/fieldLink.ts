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

// a wayline mission stored on the field hub - create_time/update_time are epoch ms
export interface FieldLinkWayline {
  id: string;
  mission_id: string;
  name: string;
  drone_model_key: string | null;
  payload_model_keys: string[];
  favorited: boolean;
  username: string | null;
  create_time: number;
  update_time: number;
}

export interface FieldLinkWaylineListResponse {
  waylines: FieldLinkWayline[];
}
