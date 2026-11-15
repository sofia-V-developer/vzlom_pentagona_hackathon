export type RadioState = 'NORMAL' | 'LIMITED' | 'OFF' | 'TRIPPED' | 'UNKNOWN';
export type GsmState = 'PASS' | 'FAIL' | 'UNKNOWN';
export type Phase = 'before' | 'after';
export type Page = 'overview' | 'settings' | 'emc' | 'report';
export type XY = { x: number; y: number };
export type Position = XY & { z: number };
export type Band = { low_mhz: number; high_mhz: number };
export type Antenna = Position & {
  id: string;
  label: string;
  gain_dbi: number;
  azimuth_deg: number;
  beamwidth_deg: number;
  back_loss_db: number;
  cable_loss_db: number;
  enabled: boolean;
};
export type Obstacle = Position & {
  id: string;
  label: string;
  kind: 'rack' | 'partition' | 'equipment';
  width: number;
  depth: number;
  height: number;
  loss_db: number;
};
export type Room = XY & {
  id: string;
  label: string;
  width: number;
  depth: number;
  drawing_area_m2: number;
};
export type Direction = {
  requested_gain_db: number;
  max_gain_db: number;
  max_output_dbm: number;
  isolation_db: number;
};
export type Filter = {
  id: string;
  label: string;
  side: 'donor' | 'service';
  healthy: boolean;
  passbands: Band[];
  insertion_loss_db: number;
  stopbands: Band[];
  stop_loss_db: number;
  failed_loss_db: number;
};
export type Config = {
  label: string;
  profile: {
    id: string;
    label: string;
    ul_band: Band;
    dl_band: Band;
    ul_mhz: number;
    dl_mhz: number;
    bandwidth_mhz: number;
  };
  layout: {
    width_m: number;
    depth_m: number;
    height_m: number;
    receiver_height_m: number;
    obstacles: Obstacle[];
    rooms?: Room[];
    source?: string | null;
    panels: Antenna[];
    donor: Antenna;
    repeater: Position;
    splitter: Position;
    gsm_antenna: Position;
  };
  radio: {
    donor_rsrp_dbm: number | null;
    donor_rssi_dbm: number | null;
    facade_rsrp_dbm: number | null;
    envelope_loss_db: number;
    splitter_loss_db: number;
    path_exponent: number;
    phone_power_dbm: number;
    outdoor_path_loss_db: number;
    base_receiver_threshold_dbm: number;
    coverage_threshold_dbm: number;
  };
  repeater: {
    enabled: boolean;
    mode: 'auto' | 'manual';
    required_margin_db: number;
    dl: Direction;
    ul: Direction;
  };
  filters: Filter[];
  gsm_criteria: {
    protected_bands: Band[];
    channels: { center_mhz: number; bandwidth_khz: number }[];
    interference_limit_dbm: number | null;
    blocker_limit_dbm: number | null;
    coupling_loss_db: number | null;
  };
};
export type GsmLine = {
  role: string;
  components: string[];
  antenna_range_mhz: number[];
  case_gsm_bands_mhz: number[];
  actual_channels_known: boolean;
  editable: false;
};
export type ConfigResponse = {
  config: Config;
  config_revision: number;
  gsm_line: GsmLine;
};
export type Gsm = {
  status: GsmState;
  missing: string[];
  channels: {
    center_mhz: number;
    bandwidth_khz: number;
    power_dbm: number | null;
    limit_dbm: number | null;
    exceeded: boolean;
  }[];
  blocker_dbm: number | null;
  blocker_limit_dbm: number | null;
  blocker_exceeded: boolean;
  protected_bands: Band[];
  components: {
    label: string;
    frequency_mhz: number;
    power_dbm: number | null;
    bandwidth_khz: number;
    depends_on_repeater: boolean;
    origin: string;
    enabled: boolean;
    protected_band_hit: boolean;
    filter_loss_db: number | null;
    coupling_loss_db: number | null;
    receiver_dbm: number | null;
    node: 'before_service_filter' | 'after_service_filter' | 'external';
  }[];
};
export type Metrics = {
  working_cells: number;
  coverage_pct: number | null;
  both_pct: number | null;
  min_rsrp_dbm: number | null;
  median_rsrp_dbm: number | null;
  worst_ul_margin_db: number | null;
};
export type ProtectionDirection = {
  requested_gain_db: number;
  applied_gain_db: number | null;
  isolation_db: number;
  stability_margin_db: number | null;
  max_output_dbm: number;
  input_power_dbm: number | null;
  output_power_dbm: number | null;
  limiter: string;
};
export type Snapshot = ConfigResponse & {
  snapshot_id: string;
  site_id: string;
  timestamp: string;
  model_version: string;
  data_source: 'simulated';
  simulation_time: number;
  scenario: string;
  seed: number;
  running: boolean;
  protection: {
    state: RadioState;
    label: string;
    reason: string;
    active: boolean;
    latched: boolean;
    required_margin_db: number;
    dl: ProtectionDirection;
    ul: ProtectionDirection;
    gsm: Gsm;
  };
  trip_gsm: Gsm | null;
  coverage: Record<Phase, Metrics> & {
    rooms?: (Record<Phase, Metrics> & { id: string })[];
    cell_width_m: number;
    cell_depth_m: number;
    cells: (XY & {
      working: boolean;
      before_dl_dbm: number | null;
      after_dl_dbm: number | null;
    })[];
  };
  branches: { id: string; label: string; enabled: boolean; active: boolean }[];
};
export type Row = {
  label: string;
  value: number;
  unit: string;
  total_dbm: number | null;
};
export type Budget = {
  snapshot_id: string;
  point: Position;
  working: boolean;
  dl_branch: string | null;
  ul_branch: string | null;
  signal_note: string | null;
  before_dl_dbm: number | null;
  after_dl_dbm: number | null;
  before_ul_margin_db: number | null;
  after_ul_margin_db: number | null;
  before_dl_rows: Row[];
  before_ul_rows: Row[];
  after_dl_rows: Row[];
  after_ul_rows: Row[];
  base_receiver_threshold_dbm: number;
};
export type Site = { id: string; label: string; state: RadioState };
export type Scenario = { id: string; label: string; description: string };
export type Telemetry = {
  timestamp: string;
  simulation_time: number;
  snapshot_id: string;
  state: RadioState;
  coverage_pct: number | null;
  rsrp_dbm: number | null;
  ul_margin_db: number | null;
  gain_dl_db: number | null;
  donor_rsrp_dbm: number | null;
  donor_rssi_dbm: number | null;
};
export type Event = {
  seq: number;
  timestamp: string;
  simulation_time: number;
  label: string;
  kind: 'action' | 'transition';
  state?: RadioState;
};
