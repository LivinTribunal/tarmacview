#!/usr/bin/env python3
"""
Runway Lights Intensity Analysis Experiment - Comprehensive Edition
====================================================================
Analyzes drone video of runway lights with 30+ quality metrics per light.
Generates an interactive HTML report for identifying faulty lights.
"""

import subprocess
import json
import math
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

# ── Configuration ──────────────────────────────────────────────────────────────

VIDEO_PATH = Path(__file__).parent / "DJI_20260205181238_0001_V_15L.MP4"
OUTPUT_HTML = Path(__file__).parent / "report.html"
OUTPUT_VIDEO = Path(__file__).parent / "annotated_lights.mp4"
GPS_CACHE = Path(__file__).parent / "gps_cache.json"
TRACKS_CACHE = Path(__file__).parent / "tracks_cache.json"

DOWNSCALE = 0.5
BRIGHTNESS_THRESHOLD = 30
CORE_BRIGHTNESS_THRESHOLD = 200
HALO_BRIGHTNESS_THRESHOLD = 15
MIN_CONTOUR_AREA = 3
MAX_CONTOUR_AREA = 5000
TRACKING_MAX_GAP = 50
TRACKING_MAX_DIST_PX = 200
MIN_TRACK_FRAMES = 100
ROI_RADIUS = 15
EARTH_RADIUS = 6371000.0
CENTER_X_MARGIN = 0.35
REFERENCE_DISTANCES = [5, 10, 15, 20]  # meters

# ── Data structures ────────────────────────────────────────────────────────────

@dataclass
class GPSFrame:
    frame_num: int
    latitude: float
    longitude: float
    rel_alt: float
    abs_alt: float
    gb_yaw: float
    gb_pitch: float
    timestamp: str
    gb_roll: float = 0.0
    iso: int = 0
    shutter: str = ""
    ev: float = 0.0
    fnum: float = 0.0
    focal_len: float = 0.0
    dzoom_ratio: float = 1.0
    color_md: str = ""
    ae_meter_md: int = 0
    dehaze_level: int = 0
    dehaze_mode: int = 0

@dataclass
class LightDetection:
    frame_num: int
    x: float
    y: float
    brightness: float
    area: float
    r: float
    g: float
    b: float
    total_intensity: float
    circularity: float = 0.0
    bright_core_area: float = 0.0
    halo_area: float = 0.0
    edge_sharpness: float = 0.0

@dataclass
class LightTrack:
    track_id: int
    detections: list = field(default_factory=list)
    peak_frame: int = 0
    peak_brightness: float = 0
    est_lat: float = 0
    est_lon: float = 0

# ── GPS extraction ─────────────────────────────────────────────────────────────

def extract_gps_from_video(video_path: Path) -> list[GPSFrame]:
    if GPS_CACHE.exists():
        print(f"  Loading cached GPS from {GPS_CACHE.name}")
        with open(GPS_CACHE) as f:
            return [GPSFrame(**d) for d in json.load(f)]
    print("  Extracting GPS with exiftool...")
    result = subprocess.run(
        ["exiftool", "-ee", "-G", "-a", str(video_path)],
        capture_output=True, text=True, timeout=300
    )
    pattern = re.compile(
        r'FrameCnt:\s*(\d+)\s+'                                              # 1: frame
        r'(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\.'                  # 2: timestamp
        r'.*?\[iso:\s*(\d+)\]\s*'                                            # 3: iso
        r'\[shutter:\s*([^\]]+)\]\s*'                                        # 4: shutter
        r'\[fnum:\s*([\d.]+)\]\s*'                                           # 5: fnum
        r'\[ev:\s*([\d.-]+)\]\s*'                                            # 6: ev
        r'\[color_md:\s*([^\]]+)\]\s*'                                       # 7: color_md
        r'\[ae_meter_md:\s*(\d+)\]\s*'                                       # 8: ae_meter_md
        r'\[focal_len:\s*([\d.]+)\]\s*'                                      # 9: focal_len
        r'\[dzoom_ratio:\s*([\d.]+)\]'                                       # 10: dzoom_ratio
        r'.*?\[latitude:\s*([\d.-]+)\]\s*'                                   # 11: latitude
        r'\[longitude:\s*([\d.-]+)\]\s*'                                     # 12: longitude
        r'\[rel_alt:\s*([\d.-]+)\s+abs_alt:\s*([\d.-]+)\]\s*'               # 13,14: alt
        r'\[gb_yaw:\s*([\d.-]+)\s+gb_pitch:\s*([\d.-]+)\s+gb_roll:\s*([\d.-]+)\]' # 15,16,17: gimbal
        r'.*?\[dehaze_level:\s*(\d+)\]\s*'                                   # 18: dehaze_level
        r'\[dehaze_mode:\s*(\d+)\]'                                          # 19: dehaze_mode
    )
    gps_frames = []
    for line in result.stdout.split('\n'):
        m = pattern.search(line)
        if m:
            gps_frames.append(GPSFrame(
                frame_num=int(m.group(1)), timestamp=m.group(2),
                iso=int(m.group(3)), shutter=m.group(4).strip(),
                fnum=float(m.group(5)), ev=float(m.group(6)),
                color_md=m.group(7).strip(), ae_meter_md=int(m.group(8)),
                focal_len=float(m.group(9)), dzoom_ratio=float(m.group(10)),
                latitude=float(m.group(11)), longitude=float(m.group(12)),
                rel_alt=float(m.group(13)), abs_alt=float(m.group(14)),
                gb_yaw=float(m.group(15)), gb_pitch=float(m.group(16)),
                gb_roll=float(m.group(17)),
                dehaze_level=int(m.group(18)), dehaze_mode=int(m.group(19)),
            ))
    with open(GPS_CACHE, 'w') as f:
        json.dump([vars(g) for g in gps_frames], f)
    print(f"  GPS: {len(gps_frames)} frames")
    return gps_frames

def deduplicate_gps(gps_frames):
    """Remove runs of identical GPS positions, keeping only actual update points.

    DJI GPS updates at ~10Hz while video is ~30fps, so 2-3 consecutive frames
    share identical coordinates. This causes step-like artifacts in distance/angle
    charts. By keeping only the first frame of each unique position, the
    interpolation function can produce smooth values between real update points.
    """
    if not gps_frames:
        return gps_frames
    deduped = [gps_frames[0]]
    for g in gps_frames[1:]:
        prev = deduped[-1]
        if g.latitude != prev.latitude or g.longitude != prev.longitude:
            deduped.append(g)
    return deduped

def interpolate_gps(gps_frames, frame_num):
    if not gps_frames:
        return None
    if frame_num <= gps_frames[0].frame_num:
        return gps_frames[0]
    if frame_num >= gps_frames[-1].frame_num:
        return gps_frames[-1]
    lo, hi = 0, len(gps_frames) - 1
    while lo < hi - 1:
        mid = (lo + hi) // 2
        if gps_frames[mid].frame_num <= frame_num:
            lo = mid
        else:
            hi = mid
    g1, g2 = gps_frames[lo], gps_frames[hi]
    if g1.frame_num == g2.frame_num:
        return g1
    t = (frame_num - g1.frame_num) / (g2.frame_num - g1.frame_num)
    return GPSFrame(
        frame_num=frame_num,
        latitude=g1.latitude + t * (g2.latitude - g1.latitude),
        longitude=g1.longitude + t * (g2.longitude - g1.longitude),
        rel_alt=g1.rel_alt + t * (g2.rel_alt - g1.rel_alt),
        abs_alt=g1.abs_alt + t * (g2.abs_alt - g1.abs_alt),
        gb_yaw=g1.gb_yaw + t * (g2.gb_yaw - g1.gb_yaw),
        gb_pitch=g1.gb_pitch + t * (g2.gb_pitch - g1.gb_pitch),
        timestamp=g1.timestamp,
        gb_roll=g1.gb_roll + t * (g2.gb_roll - g1.gb_roll),
        iso=g1.iso, shutter=g1.shutter, ev=g1.ev,
    )

# ── Distance calculation ───────────────────────────────────────────────────────

def haversine_distance(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2 * EARTH_RADIUS * math.asin(math.sqrt(a))

def signed_distance_along_track(gps, light_lat, light_lon, bearing_rad):
    dlat = math.radians(light_lat - gps.latitude)
    dlon = math.radians(light_lon - gps.longitude)
    mean_lat = math.radians((gps.latitude + light_lat) / 2)
    dx = dlon * math.cos(mean_lat) * EARTH_RADIUS
    dy = dlat * EARTH_RADIUS
    return dx * math.sin(bearing_rad) + dy * math.cos(bearing_rad)

# ── Light detection (enhanced) ─────────────────────────────────────────────────

def detect_lights_in_frame(frame_bgr, downscale=DOWNSCALE):
    h, w = frame_bgr.shape[:2]
    sh, sw = int(h * downscale), int(w * downscale)
    small = cv2.resize(frame_bgr, (sw, sh), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    _, mask = cv2.threshold(gray, BRIGHTNESS_THRESHOLD, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Halo mask (low threshold)
    _, halo_mask = cv2.threshold(gray, HALO_BRIGHTNESS_THRESHOLD, 255, cv2.THRESH_BINARY)
    # Core mask (high threshold)
    _, core_mask = cv2.threshold(gray, CORE_BRIGHTNESS_THRESHOLD, 255, cv2.THRESH_BINARY)
    # Edge gradient
    grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    grad_mag = np.sqrt(grad_x**2 + grad_y**2)

    x_min = sw * CENTER_X_MARGIN
    x_max = sw * (1 - CENTER_X_MARGIN)
    scale = 1.0 / downscale

    detections = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < MIN_CONTOUR_AREA or area > MAX_CONTOUR_AREA:
            continue
        M = cv2.moments(cnt)
        if M["m00"] == 0:
            continue
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]
        if cx < x_min or cx > x_max:
            continue

        # Circularity
        perimeter = cv2.arcLength(cnt, True)
        circularity = (4 * math.pi * area / (perimeter * perimeter)) if perimeter > 0 else 0

        # Edge sharpness: mean gradient magnitude along contour
        contour_mask = np.zeros(gray.shape, dtype=np.uint8)
        cv2.drawContours(contour_mask, [cnt], -1, 255, 2)
        edge_pixels = grad_mag[contour_mask > 0]
        edge_sharpness = float(np.mean(edge_pixels)) if len(edge_pixels) > 0 else 0

        # ROI
        roi_x1, roi_y1 = max(0, int(cx - ROI_RADIUS)), max(0, int(cy - ROI_RADIUS))
        roi_x2, roi_y2 = min(sw, int(cx + ROI_RADIUS)), min(sh, int(cy + ROI_RADIUS))
        roi = small[roi_y1:roi_y2, roi_x1:roi_x2]
        roi_gray = gray[roi_y1:roi_y2, roi_x1:roi_x2]

        bright_mask_roi = roi_gray > BRIGHTNESS_THRESHOLD
        if not bright_mask_roi.any():
            continue
        bright_pixels = roi[bright_mask_roi]
        mean_b = float(np.mean(bright_pixels[:, 0]))
        mean_g = float(np.mean(bright_pixels[:, 1]))
        mean_r = float(np.mean(bright_pixels[:, 2]))
        max_brightness = float(np.max(roi_gray))
        total_intensity = float(np.sum(roi_gray[bright_mask_roi].astype(float)))

        # Core and halo areas in ROI
        roi_core = core_mask[roi_y1:roi_y2, roi_x1:roi_x2]
        roi_halo = halo_mask[roi_y1:roi_y2, roi_x1:roi_x2]
        bright_core_area = float(np.count_nonzero(roi_core))
        halo_area = float(np.count_nonzero(roi_halo)) - bright_core_area

        detections.append(LightDetection(
            frame_num=0, x=cx * scale, y=cy * scale,
            brightness=max_brightness, area=area * scale * scale,
            r=mean_r, g=mean_g, b=mean_b, total_intensity=total_intensity,
            circularity=circularity,
            bright_core_area=bright_core_area * scale * scale,
            halo_area=max(0, halo_area) * scale * scale,
            edge_sharpness=edge_sharpness,
        ))

    detections.sort(key=lambda d: d.brightness, reverse=True)
    return detections[:10]

# ── Light tracking ─────────────────────────────────────────────────────────────

def track_lights(all_detections):
    tracks, active_tracks, next_id = [], [], 0
    for frame_num in sorted(all_detections.keys()):
        dets = all_detections[frame_num]
        matched_det_ids = set()
        for track in active_tracks:
            last_det = track.detections[-1]
            if frame_num - last_det.frame_num > TRACKING_MAX_GAP:
                continue
            best_dist, best_idx = float('inf'), -1
            for i, det in enumerate(dets):
                if i in matched_det_ids:
                    continue
                dist = math.sqrt((det.x - last_det.x)**2 + (det.y - last_det.y)**2)
                if dist < best_dist:
                    best_dist, best_idx = dist, i
            if best_idx >= 0 and best_dist < TRACKING_MAX_DIST_PX:
                det = dets[best_idx]
                det.frame_num = frame_num
                track.detections.append(det)
                if det.brightness > track.peak_brightness:
                    track.peak_brightness = det.brightness
                    track.peak_frame = frame_num
                matched_det_ids.add(best_idx)
        for i, det in enumerate(dets):
            if i in matched_det_ids:
                continue
            det.frame_num = frame_num
            t = LightTrack(track_id=next_id, detections=[det],
                           peak_frame=frame_num, peak_brightness=det.brightness)
            next_id += 1
            active_tracks.append(t)
            tracks.append(t)
        active_tracks = [t for t in active_tracks
                         if frame_num - t.detections[-1].frame_num <= TRACKING_MAX_GAP]
    return [t for t in tracks if len(t.detections) >= MIN_TRACK_FRAMES]

# ── Color science helpers ──────────────────────────────────────────────────────

def srgb_to_linear(c):
    c = c / 255.0
    return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92

def rgb_to_cie_xy(r, g, b):
    rl, gl, bl = srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b)
    X = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl
    Y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl
    Z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl
    total = X + Y + Z
    if total < 1e-10:
        return 0.3333, 0.3333
    return X / total, Y / total

def cie_xy_to_cct(x, y):
    """McCamy's approximation for correlated color temperature."""
    if abs(0.1858 - y) < 1e-10:
        return 6500
    n = (x - 0.3320) / (0.1858 - y)
    return 449 * n**3 + 3525 * n**2 + 6823.3 * n + 5520.33

# ── Advanced metrics computation ───────────────────────────────────────────────

def interpolate_at_distance(distances, values, target_dist, tolerance=1.5):
    """Interpolate value at a target distance. Uses nearest points within tolerance."""
    candidates = [(abs(d - target_dist), d, v) for d, v in zip(distances, values)
                  if abs(d - target_dist) < tolerance]
    if not candidates:
        return None
    candidates.sort()
    if len(candidates) == 1:
        return candidates[0][2]
    return (candidates[0][2] + candidates[1][2]) / 2

def compute_advanced_metrics(chart_data, fps, ground_alt):
    """Compute all advanced metrics for each light track."""
    for cd in chart_data:
        dists = cd["distances"]
        sdists = cd["signed_distances"]
        intens = cd["intensities"]
        r_vals = cd["r"]
        g_vals = cd["g"]
        b_vals = cd["b"]
        n = len(dists)
        if n < 5:
            continue

        # ── 1. Intensity at reference distances ────────────────────────────
        ref_intensities = {}
        for rd in REFERENCE_DISTANCES:
            val = interpolate_at_distance(dists, intens, rd)
            ref_intensities[rd] = val if val is not None else 0
        cd["ref_intensities"] = ref_intensities

        # ── 2. Intensity integral (area under intensity vs distance curve) ─
        # Sort by distance for proper integration
        sorted_pairs = sorted(zip(dists, intens))
        sorted_d = [p[0] for p in sorted_pairs]
        sorted_i = [p[1] for p in sorted_pairs]
        integral = sum(0.5 * (sorted_i[j] + sorted_i[j+1]) * (sorted_d[j+1] - sorted_d[j])
                       for j in range(len(sorted_d) - 1) if sorted_d[j+1] > sorted_d[j])
        cd["intensity_integral"] = integral

        # ── 3. FWHM ───────────────────────────────────────────────────────
        peak_int = max(intens)
        half_max = peak_int * 0.5
        # Find leftmost and rightmost signed distance where intensity > half_max
        above_half = [(sd, i) for sd, i in zip(sdists, intens) if i >= half_max]
        if above_half:
            sd_min = min(p[0] for p in above_half)
            sd_max = max(p[0] for p in above_half)
            cd["fwhm"] = abs(sd_max - sd_min)
        else:
            cd["fwhm"] = 0

        # ── 4. First/last detection distance ──────────────────────────────
        cd["first_detection_dist"] = dists[0]
        cd["last_detection_dist"] = dists[-1]
        cd["max_detection_dist"] = max(dists)

        # ── 5. Distance at peak intensity ─────────────────────────────────
        peak_idx = intens.index(peak_int)
        cd["distance_at_peak"] = dists[peak_idx]
        cd["signed_dist_at_peak"] = sdists[peak_idx]

        # ── 6. Saturation onset distance ──────────────────────────────────
        brightnesses = [cd["brightnesses"][j] for j in range(n)] if "brightnesses" in cd else []
        sat_frames = [(dists[j], cd["brightnesses"][j]) for j in range(n)
                      if cd["brightnesses"][j] >= 250] if "brightnesses" in cd else []
        cd["saturation_onset_dist"] = max(d for d, _ in sat_frames) if sat_frames else 0

        # ── 7. Rise rate / fall rate ──────────────────────────────────────
        # Split into approach (signed_dist > 0) and departure (signed_dist < 0)
        approach = [(sd, i) for sd, i in zip(sdists, intens) if sd > 1]
        departure = [(sd, i) for sd, i in zip(sdists, intens) if sd < -1]

        if len(approach) >= 2:
            approach.sort(key=lambda p: p[0], reverse=True)  # far to near
            total_rise = approach[-1][1] - approach[0][1]
            total_dist = approach[0][0] - approach[-1][0]
            cd["rise_rate"] = total_rise / total_dist if total_dist > 0 else 0
        else:
            cd["rise_rate"] = 0

        if len(departure) >= 2:
            departure.sort(key=lambda p: -p[0])  # near to far
            total_fall = departure[0][1] - departure[-1][1]
            total_dist = abs(departure[-1][0]) - abs(departure[0][0])
            cd["fall_rate"] = total_fall / total_dist if total_dist > 0 else 0
        else:
            cd["fall_rate"] = 0

        # ── 8. Beam asymmetry ─────────────────────────────────────────────
        approach_int = sum(i for sd, i in zip(sdists, intens) if sd > 0.5)
        departure_int = sum(i for sd, i in zip(sdists, intens) if sd < -0.5)
        cd["approach_integral"] = approach_int
        cd["departure_integral"] = departure_int
        cd["asymmetry_index"] = (approach_int / departure_int
                                 if departure_int > 0 else float('inf'))

        # ── 9. Beam elevation angle ───────────────────────────────────────
        drone_alt = cd.get("drone_alt_at_peak", ground_alt + 5)
        light_alt = ground_alt
        dist_at_peak = cd["distance_at_peak"]
        if dist_at_peak > 0.1:
            cd["beam_elevation_angle"] = math.degrees(
                math.atan2(drone_alt - light_alt, dist_at_peak))
        else:
            cd["beam_elevation_angle"] = 90.0

        # ── 10. Gaussian fit (analytical) ─────────────────────────────────
        # sigma from FWHM: sigma = FWHM / 2.355
        sigma = cd["fwhm"] / 2.355 if cd["fwhm"] > 0 else 1
        cd["gaussian_sigma"] = sigma
        cd["gaussian_amplitude"] = peak_int

        # ── 11. CIE chromaticity & CCT ────────────────────────────────────
        # Use mean R/G/B at close range (dist < 3m)
        close_r = [r_vals[j] for j in range(n) if dists[j] < 3]
        close_g = [g_vals[j] for j in range(n) if dists[j] < 3]
        close_b = [b_vals[j] for j in range(n) if dists[j] < 3]
        if close_r:
            mr = sum(close_r) / len(close_r)
            mg = sum(close_g) / len(close_g)
            mb = sum(close_b) / len(close_b)
        else:
            mr, mg, mb = sum(r_vals)/n, sum(g_vals)/n, sum(b_vals)/n
        cd["close_mean_r"], cd["close_mean_g"], cd["close_mean_b"] = mr, mg, mb
        cie_x, cie_y = rgb_to_cie_xy(mr, mg, mb)
        cd["cie_x"], cd["cie_y"] = cie_x, cie_y
        cd["cct"] = cie_xy_to_cct(cie_x, cie_y)

        # ── 12. Color ratios ──────────────────────────────────────────────
        total_rgb = mr + mg + mb
        if total_rgb > 0:
            cd["r_ratio"] = mr / total_rgb
            cd["g_ratio"] = mg / total_rgb
            cd["b_ratio"] = mb / total_rgb
        else:
            cd["r_ratio"] = cd["g_ratio"] = cd["b_ratio"] = 0.333

        # ── 13. Color consistency (std dev at close range) ────────────────
        cd["color_std_r"] = float(np.std(close_r)) if len(close_r) > 1 else 0
        cd["color_std_g"] = float(np.std(close_g)) if len(close_g) > 1 else 0
        cd["color_std_b"] = float(np.std(close_b)) if len(close_b) > 1 else 0

        # ── 14. Temporal stability (frame-to-frame variance at close range)
        close_intens = [intens[j] for j in range(n) if dists[j] < 5]
        if len(close_intens) > 2:
            diffs = [abs(close_intens[j+1] - close_intens[j])
                     for j in range(len(close_intens)-1)]
            cd["intensity_variance"] = float(np.var(close_intens))
            cd["intensity_cv"] = (float(np.std(close_intens)) /
                                  float(np.mean(close_intens))
                                  if np.mean(close_intens) > 0 else 0)
            cd["frame_to_frame_jitter"] = float(np.mean(diffs))
        else:
            cd["intensity_variance"] = 0
            cd["intensity_cv"] = 0
            cd["frame_to_frame_jitter"] = 0

        # ── 15. Centroid jitter ───────────────────────────────────────────
        # Measure deviation of (x, y) from smooth trend at close range
        close_x = [cd["x_positions"][j] for j in range(n) if dists[j] < 8]
        close_y = [cd["y_positions"][j] for j in range(n) if dists[j] < 8]
        if len(close_x) > 5:
            # Deviation from linear trend
            x_arr = np.array(close_x)
            y_arr = np.array(close_y)
            t_arr = np.arange(len(x_arr))
            # Fit linear trend
            if len(t_arr) > 1:
                x_trend = np.polyval(np.polyfit(t_arr, x_arr, 1), t_arr)
                y_trend = np.polyval(np.polyfit(t_arr, y_arr, 1), t_arr)
                x_resid = x_arr - x_trend
                y_resid = y_arr - y_trend
                cd["centroid_jitter"] = float(np.sqrt(np.mean(x_resid**2 + y_resid**2)))
            else:
                cd["centroid_jitter"] = 0
        else:
            cd["centroid_jitter"] = 0

        # ── 16. Physical appearance metrics ───────────────────────────────
        areas = cd["areas"]
        circs = cd["circularities"]
        cores = cd["bright_core_areas"]
        halos = cd["halo_areas"]
        edges = cd["edge_sharpnesses"]

        # Apparent size at ~10m
        size_at_10 = [areas[j] for j in range(n) if 8 < dists[j] < 12]
        cd["apparent_size_at_10m"] = float(np.mean(size_at_10)) if size_at_10 else 0

        # Mean circularity at close range
        close_circ = [circs[j] for j in range(n) if dists[j] < 8]
        cd["mean_circularity"] = float(np.mean(close_circ)) if close_circ else 0

        # Halo ratio at close range
        close_core = [cores[j] for j in range(n) if dists[j] < 5]
        close_halo = [halos[j] for j in range(n) if dists[j] < 5]
        if close_core and sum(close_core) > 0:
            cd["halo_ratio"] = sum(close_halo) / sum(close_core)
        else:
            cd["halo_ratio"] = 0

        # Mean edge sharpness
        close_edge = [edges[j] for j in range(n) if dists[j] < 8]
        cd["mean_edge_sharpness"] = float(np.mean(close_edge)) if close_edge else 0

    # ── 17. Spatial analysis (across all lights) ──────────────────────────
    if len(chart_data) >= 2:
        # Light spacing
        for i, cd in enumerate(chart_data):
            if i > 0:
                prev = chart_data[i - 1]
                cd["spacing_to_prev"] = haversine_distance(
                    prev["est_lat"], prev["est_lon"], cd["est_lat"], cd["est_lon"])
            else:
                cd["spacing_to_prev"] = 0

        spacings = [cd["spacing_to_prev"] for cd in chart_data if cd["spacing_to_prev"] > 0]
        median_spacing = sorted(spacings)[len(spacings)//2] if spacings else 0

        # Alignment: fit line through all light positions, measure deviation
        lats = np.array([cd["est_lat"] for cd in chart_data])
        lons = np.array([cd["est_lon"] for cd in chart_data])
        if len(lats) > 2:
            # Fit line in lat/lon space
            coeffs = np.polyfit(lons, lats, 1)
            fitted_lats = np.polyval(coeffs, lons)
            for i, cd in enumerate(chart_data):
                dlat = cd["est_lat"] - fitted_lats[i]
                cd["alignment_deviation_m"] = dlat * math.radians(1) * EARTH_RADIUS
        else:
            for cd in chart_data:
                cd["alignment_deviation_m"] = 0

        # Missing lights detection
        missing_lights = []
        for i in range(1, len(chart_data)):
            spacing = chart_data[i]["spacing_to_prev"]
            if spacing > median_spacing * 1.5 and median_spacing > 0:
                n_missing = round(spacing / median_spacing) - 1
                for k in range(1, n_missing + 1):
                    frac = k / (n_missing + 1)
                    mlat = chart_data[i-1]["est_lat"] + frac * (chart_data[i]["est_lat"] - chart_data[i-1]["est_lat"])
                    mlon = chart_data[i-1]["est_lon"] + frac * (chart_data[i]["est_lon"] - chart_data[i-1]["est_lon"])
                    missing_lights.append({"lat": mlat, "lon": mlon,
                                           "between": f'{chart_data[i-1]["label"]} - {chart_data[i]["label"]}'})
    else:
        median_spacing = 0
        missing_lights = []
        for cd in chart_data:
            cd["spacing_to_prev"] = 0
            cd["alignment_deviation_m"] = 0

    # ── 18. Neighbor-relative comparison ──────────────────────────────────
    for i, cd in enumerate(chart_data):
        neighbors = []
        if i > 0:
            neighbors.append(chart_data[i-1])
        if i < len(chart_data) - 1:
            neighbors.append(chart_data[i+1])
        if neighbors:
            neighbor_peak = sum(n_cd["peak_total"] for n_cd in neighbors) / len(neighbors)
            cd["neighbor_relative_intensity"] = (
                cd["peak_total"] / neighbor_peak if neighbor_peak > 0 else 1.0)
        else:
            cd["neighbor_relative_intensity"] = 1.0

    # ── 19. Z-scores and health score ─────────────────────────────────────
    z_metrics = [
        "peak_total", "intensity_integral", "fwhm", "max_detection_dist",
        "asymmetry_index", "cct", "mean_circularity", "halo_ratio",
        "mean_edge_sharpness", "intensity_cv", "centroid_jitter",
        "apparent_size_at_10m", "close_mean_r", "close_mean_g", "close_mean_b",
    ]
    # Compute mean and std for each metric
    metric_stats = {}
    for metric in z_metrics:
        vals = [cd.get(metric, 0) for cd in chart_data
                if cd.get(metric) is not None and not math.isinf(cd.get(metric, 0))]
        if len(vals) >= 2:
            mean_v = sum(vals) / len(vals)
            std_v = (sum((v - mean_v)**2 for v in vals) / len(vals)) ** 0.5
            metric_stats[metric] = (mean_v, std_v)
        else:
            metric_stats[metric] = (0, 1)

    for cd in chart_data:
        z_scores = {}
        for metric in z_metrics:
            mean_v, std_v = metric_stats[metric]
            val = cd.get(metric, 0)
            if val is None or math.isinf(val):
                val = mean_v
            z_scores[metric] = (val - mean_v) / std_v if std_v > 0 else 0
        cd["z_scores"] = z_scores

        # Composite health score: 100 minus weighted penalty from z-scores
        weights = {
            "peak_total": 15, "intensity_integral": 15, "fwhm": 5,
            "max_detection_dist": 5, "asymmetry_index": 8,
            "cct": 8, "mean_circularity": 5, "halo_ratio": 5,
            "mean_edge_sharpness": 4, "intensity_cv": 10, "centroid_jitter": 5,
            "apparent_size_at_10m": 5, "close_mean_r": 3, "close_mean_g": 3,
            "close_mean_b": 4,
        }
        penalty = sum(abs(z_scores.get(m, 0)) * w for m, w in weights.items()) / sum(weights.values())
        cd["health_score"] = max(0, min(100, 100 - penalty * 25))

    return chart_data, median_spacing, missing_lights, metric_stats

# ── Main processing ────────────────────────────────────────────────────────────

def process_video():
    print("=" * 60)
    print("Runway Lights Comprehensive Analysis")
    print("=" * 60)

    # Step 1: GPS
    print("\n[1/7] Extracting GPS telemetry...")
    gps_frames_raw = extract_gps_from_video(VIDEO_PATH)
    gps_frames = deduplicate_gps(gps_frames_raw)
    print(f"  {len(gps_frames_raw)} GPS frames, {len(gps_frames)} unique positions "
          f"(~{len(gps_frames_raw)/max(1,len(gps_frames)):.1f}x oversampled)")
    print(f"  Alt range [{min(g.abs_alt for g in gps_frames):.1f}..{max(g.abs_alt for g in gps_frames):.1f}]m")

    # Step 2: Video processing
    print("\n[2/7] Processing video frames...")
    cap = cv2.VideoCapture(str(VIDEO_PATH))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"  {width}x{height} @ {fps:.2f}fps, {total_frames} frames ({total_frames/fps:.1f}s)")

    all_detections = {}
    frame_num = 0
    t_start = time.time()
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        dets = detect_lights_in_frame(frame)
        if dets:
            all_detections[frame_num] = dets
        frame_num += 1
        if frame_num % 500 == 0:
            elapsed = time.time() - t_start
            spd = frame_num / elapsed
            eta = (total_frames - frame_num) / spd
            print(f"  {frame_num}/{total_frames} ({frame_num/total_frames*100:.0f}%) "
                  f"- {spd:.0f} fps - ETA {eta:.0f}s")
    cap.release()
    print(f"  Done in {time.time()-t_start:.1f}s, detections in {len(all_detections)} frames")

    # Step 3: Track lights
    print("\n[3/7] Tracking lights...")
    tracks = track_lights(all_detections)
    print(f"  {len(tracks)} tracks found")

    # Step 4: Estimate positions & build chart data
    print("\n[4/7] Computing positions and distances...")
    bearing_rad = math.atan2(
        math.radians(gps_frames[-1].longitude - gps_frames[0].longitude) *
        math.cos(math.radians(gps_frames[0].latitude)),
        math.radians(gps_frames[-1].latitude - gps_frames[0].latitude))
    ground_alts = [g.abs_alt - g.rel_alt for g in gps_frames[:100]]
    ground_alt = sum(ground_alts) / len(ground_alts)

    for track in tracks:
        total_w = sum(d.total_intensity for d in track.detections)
        if total_w > 0:
            wf = sum(d.frame_num * d.total_intensity for d in track.detections) / total_w
        else:
            wf = track.peak_frame
        gps_c = interpolate_gps(gps_frames, int(wf))
        if gps_c:
            track.est_lat, track.est_lon = gps_c.latitude, gps_c.longitude

    chart_data = []
    for track in tracks:
        frame_nums, times, distances, signed_dists = [], [], [], []
        intensities, r_vals, g_vals, b_vals = [], [], [], []
        x_positions, y_positions, areas = [], [], []
        circularities, bright_core_areas, halo_areas, edge_sharpnesses = [], [], [], []
        brightnesses = []
        h_angles, v_angles = [], []

        for det in track.detections:
            gps = interpolate_gps(gps_frames, det.frame_num)
            if not gps:
                continue
            dist_g = haversine_distance(gps.latitude, gps.longitude,
                                        track.est_lat, track.est_lon)
            signed_d = signed_distance_along_track(gps, track.est_lat, track.est_lon, bearing_rad)

            # Compute angles from light's perspective (looking up at the drone)
            drone_height = gps.rel_alt  # height above ground
            # Vertical angle (elevation): from horizontal at the light up to drone
            # 0° = light at horizon level, 90° = drone directly above
            v_ang = math.degrees(math.atan2(drone_height, dist_g)) if dist_g > 0.1 else 90.0
            # Along-track angle: angle from light's zenith in the flight-path plane
            # 0° = drone directly above, +° = drone ahead (approaching), -° = drone behind
            # Computed as atan2(signed_ground_distance, drone_height)
            h_ang = math.degrees(math.atan2(signed_d, drone_height))

            frame_nums.append(det.frame_num)
            times.append(round(det.frame_num / fps, 2))
            distances.append(dist_g)
            signed_dists.append(signed_d)
            intensities.append(det.total_intensity)
            brightnesses.append(det.brightness)
            r_vals.append(det.r)
            g_vals.append(det.g)
            b_vals.append(det.b)
            x_positions.append(det.x)
            y_positions.append(det.y)
            areas.append(det.area)
            circularities.append(det.circularity)
            bright_core_areas.append(det.bright_core_area)
            halo_areas.append(det.halo_area)
            edge_sharpnesses.append(det.edge_sharpness)
            h_angles.append(round(h_ang, 2))
            v_angles.append(round(v_ang, 2))

        # Drone altitude at peak
        peak_gps = interpolate_gps(gps_frames, track.peak_frame)
        drone_alt_at_peak = peak_gps.abs_alt if peak_gps else ground_alt + 5

        chart_data.append({
            "track_id": track.track_id,
            "num_frames": len(track.detections),
            "first_frame": track.detections[0].frame_num,
            "last_frame": track.detections[-1].frame_num,
            "peak_frame": track.peak_frame,
            "peak_brightness": track.peak_brightness,
            "peak_total": max(intensities) if intensities else 0,
            "est_lat": track.est_lat, "est_lon": track.est_lon,
            "drone_alt_at_peak": drone_alt_at_peak,
            "frame_nums": frame_nums, "times": times,
            "distances": distances, "signed_distances": signed_dists,
            "intensities": intensities, "brightnesses": brightnesses,
            "r": r_vals, "g": g_vals, "b": b_vals,
            "x_positions": x_positions, "y_positions": y_positions,
            "areas": areas, "circularities": circularities,
            "bright_core_areas": bright_core_areas,
            "halo_areas": halo_areas, "edge_sharpnesses": edge_sharpnesses,
            "h_angles": h_angles, "v_angles": v_angles,
        })

    chart_data.sort(key=lambda d: d["first_frame"])
    for i, cd in enumerate(chart_data):
        cd["label"] = f"Light {i+1}"

    # Step 5: Compute advanced metrics
    print("\n[5/7] Computing 30+ quality metrics per light...")
    chart_data, median_spacing, missing_lights, metric_stats = \
        compute_advanced_metrics(chart_data, fps, ground_alt)
    print(f"  Median spacing: {median_spacing:.1f}m")
    print(f"  Missing lights detected: {len(missing_lights)}")
    for ml in missing_lights:
        print(f"    Between {ml['between']} at ({ml['lat']:.6f}, {ml['lon']:.6f})")

    # Step 6: Generate HTML
    print("\n[6/7] Generating HTML report...")
    generate_html_report(chart_data, gps_frames, total_frames, fps, width, height,
                         ground_alt, median_spacing, missing_lights, metric_stats)
    print(f"\n  Report: {OUTPUT_HTML}")
    print("  Open in browser to view interactive charts.")

    # Step 7: Generate annotated video
    print(f"\n[7/7] Generating annotated video ({int(width*VIDEO_SCALE)}x{int(height*VIDEO_SCALE)} + sidebar)...")
    generate_annotated_video(chart_data, gps_frames, fps, total_frames, width, height)
    print(f"\n  Video: {OUTPUT_VIDEO}")

# ── Annotated Video Generation ─────────────────────────────────────────────────

VIDEO_SCALE = 0.5  # output video at half resolution

def generate_annotated_video(chart_data, gps_frames, fps, total_frames,
                             orig_w, orig_h):
    """Generate annotated video with light markers, labels, and sidebar info."""
    out_w = int(orig_w * VIDEO_SCALE)
    out_h = int(orig_h * VIDEO_SCALE)
    sidebar_w = 480
    canvas_w = out_w + sidebar_w

    # Build frame→detections lookup: {frame_num: [(label, x, y, area, dist, health, r, g, b, intensity), ...]}
    frame_lookup = {}
    for cd in chart_data:
        label = cd["label"]
        health = cd.get("health_score", 0)
        for i, fn in enumerate(cd["frame_nums"]):
            entry = (label, cd["x_positions"][i], cd["y_positions"][i],
                     cd["areas"][i], cd["distances"][i], health,
                     cd["r"][i], cd["g"][i], cd["b"][i], cd["intensities"][i])
            frame_lookup.setdefault(fn, []).append(entry)

    # Colors per light (same palette as HTML report)
    COLORS = [(31,119,180),(255,127,14),(44,160,44),(214,39,40),(148,103,189),
              (140,86,75),(227,119,194),(127,127,127),(188,189,34),(23,190,207),
              (174,199,232),(255,187,120),(152,223,138),(255,152,150),(197,176,213),
              (196,156,148),(247,182,210),(199,199,199),(219,219,141),(158,218,229),
              (57,59,121),(99,121,57),(140,109,49),(132,60,57),(123,65,115)]
    label_colors = {}
    for i, cd in enumerate(chart_data):
        c = COLORS[i % len(COLORS)]
        label_colors[cd["label"]] = (int(c[2]), int(c[1]), int(c[0]))  # BGR

    # Precompute mini-map coordinate bounds (all light positions + flight path bbox)
    all_lats = [cd["est_lat"] for cd in chart_data] + [g.latitude for g in gps_frames[::50]]
    all_lons = [cd["est_lon"] for cd in chart_data] + [g.longitude for g in gps_frames[::50]]
    map_lat_min, map_lat_max = min(all_lats), max(all_lats)
    map_lon_min, map_lon_max = min(all_lons), max(all_lons)
    # Add padding
    lat_pad = (map_lat_max - map_lat_min) * 0.15 or 0.0001
    lon_pad = (map_lon_max - map_lon_min) * 0.15 or 0.0001
    map_lat_min -= lat_pad; map_lat_max += lat_pad
    map_lon_min -= lon_pad; map_lon_max += lon_pad
    # Aspect ratio correction for longitude
    cos_lat = math.cos(math.radians((map_lat_min + map_lat_max) / 2))
    map_w_px = sidebar_w - 30  # mini-map pixel width
    map_h_px = 200  # mini-map pixel height

    def to_map_px(lat, lon):
        """Convert GPS to mini-map pixel coordinates."""
        nx = (lon - map_lon_min) / (map_lon_max - map_lon_min) if map_lon_max != map_lon_min else 0.5
        ny = 1.0 - (lat - map_lat_min) / (map_lat_max - map_lat_min) if map_lat_max != map_lat_min else 0.5
        return int(15 + nx * map_w_px), int(ny * map_h_px)

    # Pre-render static mini-map base (lights + flight path outline)
    map_base = np.zeros((map_h_px, sidebar_w, 3), dtype=np.uint8)
    map_base[:] = (40, 40, 45)
    # Draw flight path as thin gray line
    path_pts = []
    for g in gps_frames[::20]:
        path_pts.append(to_map_px(g.latitude, g.longitude))
    for i in range(len(path_pts) - 1):
        cv2.line(map_base, path_pts[i], path_pts[i+1], (70, 70, 70), 1, cv2.LINE_AA)
    # Draw light positions as dots with labels
    for i, cd in enumerate(chart_data):
        px, py = to_map_px(cd["est_lat"], cd["est_lon"])
        c = COLORS[i % len(COLORS)]
        bgr = (int(c[2]), int(c[1]), int(c[0]))
        cv2.circle(map_base, (px, py), 4, bgr, -1, cv2.LINE_AA)
        num = cd["label"].split()[-1]
        cv2.putText(map_base, num, (px + 6, py + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, bgr, 1, cv2.LINE_AA)

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    writer = cv2.VideoWriter(str(OUTPUT_VIDEO), fourcc, fps, (canvas_w, out_h))

    cap = cv2.VideoCapture(str(VIDEO_PATH))
    frame_num = 0
    t_start = time.time()

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Downscale video frame
        small = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_AREA)

        # Create canvas with sidebar
        canvas = np.zeros((out_h, canvas_w, 3), dtype=np.uint8)
        canvas[:, :out_w] = small

        # Sidebar background
        canvas[:, out_w:] = (30, 30, 35)

        # Drone telemetry for this frame
        gps = interpolate_gps(gps_frames, frame_num)
        t_sec = frame_num / fps
        mm, ss = int(t_sec // 60), t_sec % 60
        ts_text = f"{mm}:{ss:05.2f}"

        # Compute speed from GPS (m/s) over ~3 second window for stable reading
        speed_ms = 0.0
        speed_window = int(fps * 3)  # frames in 3 seconds
        if frame_num >= speed_window and gps:
            gps_prev = interpolate_gps(gps_frames, frame_num - speed_window)
            if gps_prev:
                d = haversine_distance(gps_prev.latitude, gps_prev.longitude,
                                       gps.latitude, gps.longitude)
                speed_ms = d / (speed_window / fps)  # distance / time

        # Sidebar header: frame & time
        cv2.putText(canvas, f"Frame {frame_num}  {ts_text}",
                    (out_w + 15, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                    (200, 200, 200), 2, cv2.LINE_AA)
        cv2.line(canvas, (out_w + 5, 50), (canvas_w - 5, 50), (80, 80, 80), 1)

        # Drone telemetry block
        ty = 78
        clr = (170, 170, 170)
        hdr = (130, 180, 230)
        fs = 0.45
        cv2.putText(canvas, "DRONE", (out_w + 15, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, hdr, 2, cv2.LINE_AA)
        ty += 22
        if gps:
            cv2.putText(canvas, f"Lat: {gps.latitude:.6f}", (out_w + 15, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"Lon: {gps.longitude:.6f}", (out_w + 245, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            ty += 20
            cv2.putText(canvas, f"Alt: {gps.rel_alt:.1f}m", (out_w + 15, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"Speed: {speed_ms:.1f} m/s ({speed_ms*3.6:.1f} km/h)",
                        (out_w + 155, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            ty += 14
        cv2.line(canvas, (out_w + 5, ty), (canvas_w - 5, ty), (60, 60, 60), 1)
        ty += 16

        # Gimbal block
        cv2.putText(canvas, "GIMBAL", (out_w + 15, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, hdr, 2, cv2.LINE_AA)
        ty += 22
        if gps:
            cv2.putText(canvas, f"Yaw: {gps.gb_yaw:.1f}", (out_w + 15, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"Pitch: {gps.gb_pitch:.1f}", (out_w + 165, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"Roll: {gps.gb_roll:.1f}", (out_w + 330, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            ty += 14
        cv2.line(canvas, (out_w + 5, ty), (canvas_w - 5, ty), (60, 60, 60), 1)
        ty += 16

        # Camera block
        cv2.putText(canvas, "CAMERA", (out_w + 15, ty),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, hdr, 2, cv2.LINE_AA)
        ty += 22
        if gps:
            cv2.putText(canvas, f"ISO: {gps.iso}", (out_w + 15, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"Shut: {gps.shutter}", (out_w + 130, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"EV: {gps.ev:+.1f}", (out_w + 295, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            ty += 20
            cv2.putText(canvas, f"f/{gps.fnum:.1f}", (out_w + 15, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"{gps.focal_len:.0f}mm", (out_w + 100, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"Zoom: {gps.dzoom_ratio:.1f}x", (out_w + 195, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            cv2.putText(canvas, f"Dehaze: {gps.dehaze_level}", (out_w + 340, ty),
                        cv2.FONT_HERSHEY_SIMPLEX, fs, clr, 1, cv2.LINE_AA)
            ty += 14
        cv2.line(canvas, (out_w + 5, ty), (canvas_w - 5, ty), (80, 80, 80), 1)

        dets = frame_lookup.get(frame_num, [])

        # Draw markers on video frame
        for (label, x, y, area, dist, health, r, g, b, intensity) in dets:
            # Scale coordinates to output size
            sx = int(x * VIDEO_SCALE)
            sy = int(y * VIDEO_SCALE)
            # Box size proportional to sqrt(area), minimum 12px
            half = max(12, int(math.sqrt(area * VIDEO_SCALE * VIDEO_SCALE) * 1.2))
            color = label_colors.get(label, (0, 255, 0))
            # Rectangle
            cv2.rectangle(canvas, (sx - half, sy - half), (sx + half, sy + half),
                          color, 2, cv2.LINE_AA)
            # Label above box
            num = label.split()[-1]  # "Light 5" -> "5"
            cv2.putText(canvas, num, (sx - half, sy - half - 6),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2, cv2.LINE_AA)

        # Sidebar: show info for each visible light
        sidebar_y = ty + 20
        if dets:
            cv2.putText(canvas, "VISIBLE LIGHTS", (out_w + 15, sidebar_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (160, 160, 160), 2, cv2.LINE_AA)
            sidebar_y += 35

            # Sort by label number
            dets_sorted = sorted(dets, key=lambda d: int(d[0].split()[-1]))
            for (label, x, y, area, dist, health, r, g, b, intensity) in dets_sorted:
                if sidebar_y > out_h - 30:
                    break
                color = label_colors.get(label, (0, 255, 0))
                num = label.split()[-1]

                # Light number with color dot
                cv2.circle(canvas, (out_w + 22, sidebar_y - 6), 8, color, -1, cv2.LINE_AA)
                cv2.putText(canvas, f"Light {num}", (out_w + 38, sidebar_y),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (220, 220, 220), 2, cv2.LINE_AA)

                # Health score badge
                if health >= 80:
                    hc = (44, 160, 44)
                elif health >= 60:
                    hc = (34, 189, 188)
                else:
                    hc = (39, 40, 214)
                cv2.putText(canvas, f"HP:{health:.0f}", (out_w + 340, sidebar_y),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, hc, 2, cv2.LINE_AA)
                sidebar_y += 28

                # Distance and intensity
                cv2.putText(canvas, f"Dist: {dist:.1f}m   Int: {intensity:.0f}",
                            (out_w + 38, sidebar_y),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (150, 150, 150), 1, cv2.LINE_AA)
                sidebar_y += 24

                # RGB values with colored text
                cv2.putText(canvas, f"R:{r:.0f}", (out_w + 38, sidebar_y),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (100, 100, 220), 1, cv2.LINE_AA)
                cv2.putText(canvas, f"G:{g:.0f}", (out_w + 145, sidebar_y),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (100, 200, 100), 1, cv2.LINE_AA)
                cv2.putText(canvas, f"B:{b:.0f}", (out_w + 250, sidebar_y),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 130, 100), 1, cv2.LINE_AA)
                sidebar_y += 32
        else:
            cv2.putText(canvas, "No lights in view", (out_w + 15, sidebar_y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.65, (100, 100, 100), 1, cv2.LINE_AA)

        # Mini-map at bottom of sidebar
        map_y_start = out_h - map_h_px - 30
        cv2.putText(canvas, "MAP", (out_w + 15, map_y_start - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (130, 180, 230), 1, cv2.LINE_AA)
        # Copy static base then overlay drone position
        mini_map = map_base.copy()
        if gps:
            dx, dy = to_map_px(gps.latitude, gps.longitude)
            # Drone triangle marker
            cv2.circle(mini_map, (dx, dy), 7, (0, 200, 255), -1, cv2.LINE_AA)
            cv2.circle(mini_map, (dx, dy), 7, (255, 255, 255), 1, cv2.LINE_AA)
        canvas[map_y_start:map_y_start + map_h_px, out_w:out_w + sidebar_w] = mini_map

        writer.write(canvas)
        frame_num += 1
        if frame_num % 500 == 0:
            elapsed = time.time() - t_start
            spd = frame_num / elapsed
            eta = (total_frames - frame_num) / spd
            print(f"  {frame_num}/{total_frames} ({frame_num/total_frames*100:.0f}%) "
                  f"- {spd:.0f} fps - ETA {eta:.0f}s")

    cap.release()
    writer.release()
    print(f"  Done in {time.time()-t_start:.1f}s")

    # Re-encode with H.264 for smaller size and browser compatibility
    h264_path = OUTPUT_VIDEO.with_suffix('.h264.mp4')
    try:
        subprocess.run([
            'ffmpeg', '-y', '-i', str(OUTPUT_VIDEO),
            '-c:v', 'libx264', '-crf', '23', '-preset', 'medium',
            '-pix_fmt', 'yuv420p', str(h264_path)
        ], capture_output=True, timeout=600)
        h264_path.replace(OUTPUT_VIDEO)
        print(f"  Re-encoded to H.264: {OUTPUT_VIDEO.stat().st_size / 1024 / 1024:.1f} MB")
    except (subprocess.TimeoutExpired, FileNotFoundError):
        print(f"  ffmpeg not available, kept raw mp4v: {OUTPUT_VIDEO.stat().st_size / 1024 / 1024:.1f} MB")

# ── HTML Report ────────────────────────────────────────────────────────────────

def generate_html_report(chart_data, gps_frames, total_frames, fps, w, h,
                         ground_alt, median_spacing, missing_lights, metric_stats):
    N = len(chart_data)
    labels = [cd["label"] for cd in chart_data]
    labels_json = json.dumps(labels)

    gps_lats = [g.latitude for g in gps_frames[::10]]
    gps_lons = [g.longitude for g in gps_frames[::10]]
    gps_alts = [g.rel_alt for g in gps_frames[::10]]
    gps_times = [round(g.frame_num / fps, 2) for g in gps_frames[::10]]

    # Speed profile: compute from GPS over ~3s window, sampled every 10 GPS points
    speed_window = int(fps * 3)  # frames in 3 seconds
    gps_speed_times = []
    gps_speeds_ms = []
    sampled = gps_frames[::10]
    for g in sampled:
        fn = g.frame_num
        if fn < speed_window:
            gps_speed_times.append(round(fn / fps, 2))
            gps_speeds_ms.append(0.0)
            continue
        g_prev = interpolate_gps(gps_frames, fn - speed_window)
        if g_prev:
            d = haversine_distance(g_prev.latitude, g_prev.longitude,
                                   g.latitude, g.longitude)
            spd = d / (speed_window / fps)
        else:
            spd = 0.0
        gps_speed_times.append(round(fn / fps, 2))
        gps_speeds_ms.append(round(spd, 2))

    # Gimbal & drone heading data (sampled every 10 GPS points)
    gps_gb_yaws = [round(g.gb_yaw, 1) for g in sampled]
    gps_gb_pitches = [round(g.gb_pitch, 1) for g in sampled]
    gps_gb_rolls = [round(g.gb_roll, 2) for g in sampled]

    # Drone heading (course over ground) from consecutive GPS positions
    gps_headings = [0.0]
    for i in range(1, len(sampled)):
        g1, g2 = sampled[i - 1], sampled[i]
        dlat = math.radians(g2.latitude - g1.latitude)
        dlon = math.radians(g2.longitude - g1.longitude)
        mean_lat = math.radians((g1.latitude + g2.latitude) / 2)
        dx = dlon * math.cos(mean_lat)
        dy = dlat
        heading = math.degrees(math.atan2(dx, dy)) % 360
        gps_headings.append(round(heading, 1))
    # First heading = second heading (no delta for frame 0)
    if len(gps_headings) > 1:
        gps_headings[0] = gps_headings[1]

    # Camera exposure & lens data
    gps_isos = [g.iso for g in sampled]
    gps_evs = [round(g.ev, 1) for g in sampled]
    gps_fnums = [round(g.fnum, 1) for g in sampled]
    gps_focals = [round(g.focal_len, 1) for g in sampled]
    gps_dzooms = [round(g.dzoom_ratio, 2) for g in sampled]
    gps_dehaze_lvls = [g.dehaze_level for g in sampled]
    # Shutter speed as numeric value (1/x -> x for display)
    gps_shutter_vals = []
    for g in sampled:
        try:
            if '/' in g.shutter:
                gps_shutter_vals.append(round(float(g.shutter.split('/')[1]), 1))
            else:
                gps_shutter_vals.append(round(float(g.shutter), 4))
        except (ValueError, IndexError):
            gps_shutter_vals.append(0)

    light_lats = [cd["est_lat"] for cd in chart_data]
    light_lons = [cd["est_lon"] for cd in chart_data]

    peak_totals = [cd["peak_total"] for cd in chart_data]
    mean_peak = sum(peak_totals) / N if N else 0

    health_scores = [cd.get("health_score", 50) for cd in chart_data]
    mean_health = sum(health_scores) / N if N else 0

    COLORS = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd',
              '#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf',
              '#aec7e8','#ffbb78','#98df8a','#ff9896','#c5b0d5',
              '#c49c94','#f7b6d2','#c7c7c7','#dbdb8d','#9edae5',
              '#393b79','#637939','#8c6d31','#843c39','#7b4173']

    def traces_dist(y_key, color=None):
        traces = []
        for i, cd in enumerate(chart_data):
            c = color or COLORS[i % len(COLORS)]
            traces.append({
                "x": cd["distances"], "y": cd[y_key], "mode": "lines",
                "name": cd["label"], "line": {"width": 1.5, "color": c},
                **({"opacity": 0.7} if color else {}),
                "hovertemplate": f'{cd["label"]}<br>Dist: %{{x:.1f}}m<br>Val: %{{y:.1f}}<extra></extra>'
            })
        return json.dumps(traces)

    def traces_signed(y_key, color=None):
        traces = []
        for i, cd in enumerate(chart_data):
            c = color or COLORS[i % len(COLORS)]
            traces.append({
                "x": cd["signed_distances"], "y": cd[y_key], "mode": "lines",
                "name": cd["label"], "line": {"width": 1.5, "color": c},
                **({"opacity": 0.7} if color else {}),
                "hovertemplate": f'{cd["label"]}<br>SignedDist: %{{x:.1f}}m<br>Val: %{{y:.1f}}<extra></extra>'
            })
        return json.dumps(traces)

    def traces_time(y_key, color=None):
        traces = []
        for i, cd in enumerate(chart_data):
            c = color or COLORS[i % len(COLORS)]
            htexts = []
            for j in range(len(cd["times"])):
                ts = cd["times"][j]
                mm, ss = int(ts // 60), ts % 60
                htexts.append(f'{cd["label"]}<br>Time: {mm}:{ss:05.2f}<br>'
                              f'Dist: {cd["distances"][j]:.1f}m<br>Val: {cd[y_key][j]:.1f}')
            traces.append({
                "x": cd["times"], "y": cd[y_key], "mode": "lines",
                "name": cd["label"], "line": {"width": 1.5, "color": c},
                **({"opacity": 0.7} if color else {}),
                "text": htexts, "hovertemplate": '%{text}<extra></extra>',
            })
        return json.dumps(traces)

    def traces_hangle(y_key, color=None):
        traces = []
        for i, cd in enumerate(chart_data):
            c = color or COLORS[i % len(COLORS)]
            traces.append({
                "x": cd["h_angles"], "y": cd[y_key], "mode": "lines",
                "name": cd["label"], "line": {"width": 1.5, "color": c},
                **({"opacity": 0.7} if color else {}),
                "hovertemplate": f'{cd["label"]}<br>Along-track: %{{x:.1f}}°<br>Val: %{{y:.1f}}<extra></extra>'
            })
        return json.dumps(traces)

    def traces_vangle(y_key, color=None):
        traces = []
        for i, cd in enumerate(chart_data):
            c = color or COLORS[i % len(COLORS)]
            traces.append({
                "x": cd["v_angles"], "y": cd[y_key], "mode": "lines",
                "name": cd["label"], "line": {"width": 1.5, "color": c},
                **({"opacity": 0.7} if color else {}),
                "hovertemplate": f'{cd["label"]}<br>V.Angle: %{{x:.1f}}°<br>Val: %{{y:.1f}}<extra></extra>'
            })
        return json.dumps(traces)

    # Normalized beam pattern traces (intensity / peak, vs signed distance)
    norm_traces = []
    for i, cd in enumerate(chart_data):
        pk = cd["peak_total"]
        if pk <= 0:
            continue
        norm_traces.append({
            "x": cd["signed_distances"],
            "y": [v / pk for v in cd["intensities"]],
            "mode": "lines", "name": cd["label"],
            "line": {"width": 1.5, "color": COLORS[i % len(COLORS)]},
            "hovertemplate": f'{cd["label"]}<br>SignedDist: %{{x:.1f}}m<br>Normalized: %{{y:.3f}}<extra></extra>'
        })
    norm_traces_json = json.dumps(norm_traces)

    # Reference distance bar chart data
    ref_dist_traces = []
    for rd in REFERENCE_DISTANCES:
        ref_dist_traces.append({
            "x": labels, "y": [cd.get("ref_intensities", {}).get(rd, 0) for cd in chart_data],
            "type": "bar", "name": f"{rd}m",
        })
    ref_dist_json = json.dumps(ref_dist_traces)

    # Helper: simple bar data
    def bar_vals(key):
        return json.dumps([round(cd.get(key, 0), 2) for cd in chart_data])

    # CIE diagram data
    cie_xs = [cd.get("cie_x", 0.33) for cd in chart_data]
    cie_ys = [cd.get("cie_y", 0.33) for cd in chart_data]

    # Z-score heatmap
    z_metrics_display = ["peak_total", "intensity_integral", "fwhm", "max_detection_dist",
                         "asymmetry_index", "cct", "mean_circularity", "halo_ratio",
                         "mean_edge_sharpness", "intensity_cv", "centroid_jitter",
                         "apparent_size_at_10m"]
    z_metric_labels = ["Peak Int.", "Integral", "FWHM", "Det. Range",
                       "Asymmetry", "CCT", "Circularity", "Halo",
                       "Edge Sharp.", "Intensity CV", "Jitter", "Size@10m"]
    z_matrix = []
    for cd in chart_data:
        row = [round(cd.get("z_scores", {}).get(m, 0), 2) for m in z_metrics_display]
        z_matrix.append(row)

    # Health score colors
    def health_color(score):
        if score >= 80:
            return '#2ca02c'
        elif score >= 60:
            return '#bcbd22'
        elif score >= 40:
            return '#ff7f0e'
        return '#d62728'

    health_colors = [health_color(s) for s in health_scores]

    # Spacing data
    spacings = [round(cd.get("spacing_to_prev", 0), 1) for cd in chart_data]
    alignment_devs = [round(cd.get("alignment_deviation_m", 0), 3) for cd in chart_data]

    # Missing lights for map
    ml_lats = [ml["lat"] for ml in missing_lights]
    ml_lons = [ml["lon"] for ml in missing_lights]
    ml_labels = [ml["between"] for ml in missing_lights]

    # Summary table
    table_rows = ""
    for cd in chart_data:
        t0 = cd["first_frame"] / fps
        t1 = cd["last_frame"] / fps
        ts0 = f"{int(t0//60)}:{t0%60:05.2f}"
        ts1 = f"{int(t1//60)}:{t1%60:05.2f}"
        dev = ((cd["peak_total"] - mean_peak) / mean_peak * 100) if mean_peak > 0 else 0
        hs = cd.get("health_score", 0)
        hc = health_color(hs)
        flag = f' style="background-color: #ffe0e0;"' if hs < 60 else ''
        table_rows += f"""<tr{flag}>
<td>{cd['label']}</td><td>{cd['num_frames']}</td>
<td>{cd['first_frame']}-{cd['last_frame']}</td><td>{ts0} - {ts1}</td>
<td>{cd['peak_total']:.0f}</td><td>{dev:+.1f}%</td>
<td>{cd.get('intensity_integral',0):.0f}</td><td>{cd.get('fwhm',0):.1f}</td>
<td>{cd.get('asymmetry_index',0):.2f}</td><td>{cd.get('cct',0):.0f}K</td>
<td style="color:#cc0000">{cd.get('close_mean_r',0):.0f}</td>
<td style="color:#00aa00">{cd.get('close_mean_g',0):.0f}</td>
<td style="color:#0000cc">{cd.get('close_mean_b',0):.0f}</td>
<td>{cd.get('intensity_cv',0):.3f}</td>
<td>{cd.get('centroid_jitter',0):.1f}</td>
<td>{cd.get('spacing_to_prev',0):.1f}</td>
<td>{cd.get('alignment_deviation_m',0):.2f}</td>
<td style="color:{hc};font-weight:bold">{hs:.0f}</td>
</tr>"""

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Runway Lights - Comprehensive Analysis</title>
<script src="https://cdn.plot.ly/plotly-2.35.0.min.js"></script>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
       margin:0; padding:20px; background:#f5f5f5; color:#333; }}
.container {{ max-width:1500px; margin:0 auto; }}
h1 {{ color:#1a1a2e; border-bottom:3px solid #16213e; padding-bottom:10px; }}
h2 {{ color:#16213e; margin-top:40px; }}
h3 {{ color:#333; margin-top:25px; font-size:14px; }}
.section {{ background:#e8eaf0; border-radius:8px; padding:5px 15px; margin:30px 0 10px; }}
.section h2 {{ margin:10px 0; font-size:18px; }}
.cc {{ background:white; border-radius:8px; padding:20px;
       box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:20px; }}
.ig {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
       gap:12px; margin-bottom:25px; }}
.ic {{ background:white; border-radius:8px; padding:12px;
       box-shadow:0 2px 10px rgba(0,0,0,0.1); text-align:center; }}
.ic .v {{ font-size:22px; font-weight:bold; color:#16213e; }}
.ic .l {{ font-size:11px; color:#666; margin-top:4px; }}
table {{ width:100%; border-collapse:collapse; font-size:11px; }}
th,td {{ padding:5px 8px; text-align:center; border:1px solid #ddd; }}
th {{ background:#16213e; color:white; position:sticky; top:0; }}
tr:nth-child(even) {{ background:#f9f9f9; }}
.desc {{ background:white; border-radius:8px; padding:15px;
         box-shadow:0 2px 10px rgba(0,0,0,0.1); margin-bottom:20px; line-height:1.5; font-size:13px; }}
</style></head><body>
<div class="container">
<h1>Runway Lights - Comprehensive Quality Analysis</h1>
<div class="desc">
<strong>Video:</strong> {VIDEO_PATH.name} &nbsp;|&nbsp;
<strong>Resolution:</strong> {w}x{h} @ {fps:.2f}fps &nbsp;|&nbsp;
<strong>Duration:</strong> {total_frames/fps:.1f}s ({total_frames} frames) &nbsp;|&nbsp;
<strong>Lights:</strong> {N} detected &nbsp;|&nbsp;
<strong>Median spacing:</strong> {median_spacing:.1f}m &nbsp;|&nbsp;
<strong>Missing lights:</strong> {len(missing_lights)}
</div>

<div class="ig">
<div class="ic"><div class="v">{N}</div><div class="l">Lights Detected</div></div>
<div class="ic"><div class="v">{mean_peak:.0f}</div><div class="l">Mean Peak Intensity</div></div>
<div class="ic"><div class="v">{median_spacing:.1f}m</div><div class="l">Median Spacing</div></div>
<div class="ic"><div class="v">{len(missing_lights)}</div><div class="l">Missing Lights</div></div>
<div class="ic"><div class="v" style="color:{health_color(mean_health)}">{mean_health:.0f}</div><div class="l">Mean Health Score</div></div>
</div>

<!-- ═══════════ SECTION A: INTENSITY PROFILE ═══════════ -->
<div class="section"><h2>A. Intensity Profile Analysis</h2></div>
<div class="desc">This section analyses each light's brightness profile as the drone flies over it. All runway edge lights of the same type should produce nearly identical intensity curves. Significant deviations indicate a failing, dirty, or misaligned fixture.</div>

<h3>A1. Total Intensity vs Distance to Light</h3>
<div class="desc">Shows total intensity (sum of all bright pixel values) vs ground distance to the light. Each line represents one light. As the drone approaches, intensity rises to a peak then falls. All lights should have similar bell-shaped profiles with comparable peak heights. Outlier curves that are notably lower or narrower suggest a degraded or faulty light.</div>
<div class="cc"><div id="c_int_dist" style="height:450px"></div></div>

<h3>A2. Normalized Beam Pattern (all lights overlaid, peak=1.0)</h3>
<div class="desc">Each light's intensity is divided by its own peak, so all peaks align at 1.0. Signed distance axis: positive = drone approaching, negative = drone receding. This isolates beam <em>shape</em> differences from absolute brightness differences. Lights with notably wider or narrower profiles, or asymmetric shapes, may have optical or alignment issues.</div>
<div class="cc"><div id="c_norm_beam" style="height:450px"></div></div>

<h3>A3. Peak Total Intensity Comparison</h3>
<div class="desc">Bar chart of the maximum total intensity recorded for each light. The blue dashed line shows the group mean. Lights significantly below the mean are candidate faulty lights. Expect ±20% variation for healthy fixtures; deviations beyond ±30% warrant investigation.</div>
<div class="cc"><div id="c_peak_bar" style="height:350px"></div></div>

<h3>A4. Intensity at Reference Distances ({', '.join(f'{d}m' for d in REFERENCE_DISTANCES)})</h3>
<div class="desc">Grouped bar chart showing each light's intensity at specific reference distances ({', '.join(f'{d}m' for d in REFERENCE_DISTANCES)}). This normalizes the comparison by removing the effect of how close the drone happened to fly. Consistent values across all lights at each distance confirm uniform light output.</div>
<div class="cc"><div id="c_ref_dist" style="height:350px"></div></div>

<h3>A5. Intensity Integral (total energy under curve)</h3>
<div class="desc">The area under the intensity-vs-distance curve, representing total cumulative light energy captured during flyover. A lower integral means the drone received less total light from this fixture - possibly due to dimmer output, narrower beam, or shorter detection range.</div>
<div class="cc"><div id="c_integral" style="height:300px"></div></div>

<h3>A6. FWHM - Beam Width at Half Maximum (m)</h3>
<div class="desc">Full Width at Half Maximum: the distance span over which intensity stays above 50% of the peak. Wider FWHM = broader, more spread beam; narrow FWHM = tightly focused beam. All lights of the same type should have similar FWHM. Unusually narrow values may indicate a partially obstructed lens.</div>
<div class="cc"><div id="c_fwhm" style="height:300px"></div></div>

<h3>A7. Detection Range (max distance where light is visible)</h3>
<div class="desc">The maximum ground distance at which the light was first detected above the brightness threshold. Shorter detection range suggests a dimmer light or one with a more directional beam that the drone approaches off-axis. Consistent range across lights is expected for uniform runway lighting.</div>
<div class="cc"><div id="c_det_range" style="height:300px"></div></div>

<h3>A8. Saturation Onset Distance &amp; Distance at Peak</h3>
<div class="desc">Two metrics: (1) the distance at which the camera sensor first saturates (pixel reaches 255), and (2) the distance at which peak total intensity occurs. If saturation onset is far from the light, the light may be overly bright. These should be consistent across all lights.</div>
<div class="cc"><div id="c_sat_peak" style="height:300px"></div></div>

<h3>A9. Rise Rate (approach) vs Fall Rate (departure) - intensity/m</h3>
<div class="desc">How quickly intensity increases per meter during approach (green) and decreases during departure (red). These rates characterize the beam's angular concentration. A light with much faster rise than fall (or vice versa) may be tilted or have asymmetric optics.</div>
<div class="cc"><div id="c_rise_fall" style="height:300px"></div></div>

<!-- ═══════════ SECTION B: BEAM PATTERN ═══════════ -->
<div class="section"><h2>B. Beam Pattern &amp; Directionality</h2></div>
<div class="desc">This section examines the directional properties of each light's beam. Runway lights should project light symmetrically along the flight path with consistent angular characteristics.</div>

<h3>B1. Beam Asymmetry Index (approach/departure integral ratio)</h3>
<div class="desc">Ratio of total light energy on the approach side (positive signed distance) to the departure side. A value of 1.0 means perfectly symmetric beam. Values &gt;1 = brighter during approach; &lt;1 = brighter during departure. The red dashed line marks 1.0 (perfect symmetry). Significant deviation suggests the light fixture is tilted along the runway axis.</div>
<div class="cc"><div id="c_asym" style="height:300px"></div></div>

<h3>B2. Beam Elevation Angle at Peak (degrees)</h3>
<div class="desc">The vertical angle from horizontal at which peak intensity occurs, calculated as arctan(drone altitude / ground distance at peak). All lights should have similar elevation angles. A light with a notably different angle may be physically tilted or have its mounting bracket misaligned.</div>
<div class="cc"><div id="c_elev" style="height:300px"></div></div>

<h3>B3. Gaussian Sigma (beam spread parameter, m)</h3>
<div class="desc">The standard deviation (sigma) from fitting a Gaussian curve to the beam profile. Larger sigma = wider, more diffuse beam; smaller sigma = tighter, more focused beam. This captures the overall beam spread in a single number. Inconsistent sigma values suggest varying optical focus or lens condition.</div>
<div class="cc"><div id="c_sigma" style="height:300px"></div></div>

<!-- ═══════════ SECTION C: COLOR ANALYSIS ═══════════ -->
<div class="section"><h2>C. Color Analysis</h2></div>
<div class="desc">Color analysis reveals whether all lights produce the same spectral output. Lights of the same type and age should have nearly identical color profiles. Color shifts can indicate aging lamps, different lamp types, or contaminated optics.</div>

<h3>C1. R/G/B Channels vs Distance</h3>
<div class="desc">Three separate charts showing how the Red, Green, and Blue channel intensities change with distance for each light. All lights of the same type should produce overlapping curves within each channel. A light with a different color balance (e.g. more red, less blue) will stand out.</div>
<div class="cc"><div id="c_red" style="height:350px"></div></div>
<div class="cc"><div id="c_green" style="height:350px"></div></div>
<div class="cc"><div id="c_blue" style="height:350px"></div></div>

<h3>C2. CIE 1931 Chromaticity Diagram</h3>
<div class="desc">Each light plotted on the CIE 1931 xy chromaticity diagram, which represents perceived color independent of brightness. Tight clustering indicates all lights have the same color. Outliers far from the group may have a different color temperature, degraded phosphor, or contaminated lens. Points are colored by health score.</div>
<div class="cc"><div id="c_cie" style="height:450px"></div></div>

<h3>C3. Correlated Color Temperature (K)</h3>
<div class="desc">The Correlated Color Temperature (CCT) in Kelvin, derived from CIE chromaticity via McCamy's approximation. Higher values = cooler/bluer light; lower values = warmer/yellower light. For uniform runway lighting, all lights should have CCT within a narrow range (±200K). Large variation indicates mixed lamp types or aged lamps.</div>
<div class="cc"><div id="c_cct" style="height:300px"></div></div>

<h3>C4. Color Ratios (R/G/B fraction at close range)</h3>
<div class="desc">Stacked bar chart showing the fraction of Red, Green, and Blue in each light's close-range color. The bars should all look identical for uniform lighting. A noticeably different color mix (e.g. one light with more red fraction) flags a potential color issue.</div>
<div class="cc"><div id="c_color_ratio" style="height:300px"></div></div>

<h3>C5. Mean R/G/B at Close Range (&lt;3m)</h3>
<div class="desc">Absolute mean Red, Green, and Blue pixel values when the drone is within 3m ground distance. Unlike ratios, this shows absolute brightness per channel. Grouped bars allow direct comparison of each channel across all lights.</div>
<div class="cc"><div id="c_rgb_bar" style="height:300px"></div></div>

<h3>C6. Color Consistency (std deviation of R/G/B at close range)</h3>
<div class="desc">Standard deviation of each color channel across close-range frames. Low values mean the light's color is stable during flyover. High values may indicate color flickering, uneven phosphor coating, or sensor noise issues with that particular light.</div>
<div class="cc"><div id="c_color_std" style="height:300px"></div></div>

<!-- ═══════════ SECTION D: TIME-BASED ═══════════ -->
<div class="section"><h2>D. Time-Based Analysis</h2></div>
<div class="desc">Time-based charts show the same intensity and color data plotted against video time instead of distance. This gives a chronological view of the light encounters. Hover over any point to see the distance to the light at that moment. Useful for correlating observations with specific moments in the video.</div>

<h3>D1. Total Intensity vs Video Time</h3>
<div class="desc">Total intensity of each light plotted against video time (seconds). Each bell-shaped pulse corresponds to one light flyover. The sequence from left to right matches the drone's flight path. Tooltip shows ground distance for context.</div>
<div class="cc"><div id="c_int_time" style="height:450px"></div></div>

<h3>D2. R / G / B vs Video Time</h3>
<div class="desc">Red, Green, and Blue channel intensities vs video time. Three separate charts for clarity. Tooltip shows ground distance. Compare the temporal color profiles - all lights should produce similar color pulses at similar relative intensities.</div>
<div class="cc"><div id="c_r_time" style="height:350px"></div></div>
<div class="cc"><div id="c_g_time" style="height:350px"></div></div>
<div class="cc"><div id="c_b_time" style="height:350px"></div></div>

<!-- ═══════════ SECTION D+: ANGULAR ANALYSIS ═══════════ -->
<div class="section"><h2>D+. Angular Beam Analysis</h2></div>
<div class="desc">These charts show intensity and color as a function of the viewing angle from the light's perspective. Along-track angle is measured in the vertical plane of the flight path: 0° = drone directly above the light, positive = drone ahead (approaching), negative = drone behind (receding). Vertical angle (elevation) is measured from horizontal at the light up to the drone. Angular analysis reveals the true beam pattern independent of flight speed.</div>

<h3>D+1. Total Intensity vs Along-Track Angle</h3>
<div class="desc">Total intensity plotted against the along-track angle from the light's zenith (degrees). 0° = drone directly overhead, ±90° = drone at ground level. All lights should produce similar bell-shaped curves centered near 0°. Asymmetry between positive (approach) and negative (departure) sides indicates a tilted fixture.</div>
<div class="cc"><div id="c_int_hang" style="height:450px"></div></div>

<h3>D+2. Total Intensity vs Vertical Angle (Elevation)</h3>
<div class="desc">Total intensity vs vertical elevation angle from the light to the drone. Higher angles mean the drone is more directly above. This reveals the vertical beam pattern - at what elevation the light is brightest. A consistent peak elevation across all lights confirms uniform vertical aiming.</div>
<div class="cc"><div id="c_int_vang" style="height:450px"></div></div>

<h3>D+3. R / G / B vs Along-Track Angle</h3>
<div class="desc">Red, Green, and Blue channels plotted against along-track angle. Reveals whether color varies with viewing angle (chromatic beam effects). Some light types may shift color at extreme angles.</div>
<div class="cc"><div id="c_r_hang" style="height:350px"></div></div>
<div class="cc"><div id="c_g_hang" style="height:350px"></div></div>
<div class="cc"><div id="c_b_hang" style="height:350px"></div></div>

<h3>D+4. R / G / B vs Vertical Angle (Elevation)</h3>
<div class="desc">Red, Green, and Blue channels vs vertical elevation angle. Shows whether color composition changes at different viewing elevations. Useful for detecting lights with damaged filters or optics that alter color at specific angles.</div>
<div class="cc"><div id="c_r_vang" style="height:350px"></div></div>
<div class="cc"><div id="c_g_vang" style="height:350px"></div></div>
<div class="cc"><div id="c_b_vang" style="height:350px"></div></div>

<!-- ═══════════ SECTION E: SPATIAL ═══════════ -->
<div class="section"><h2>E. Spatial Analysis</h2></div>
<div class="desc">Spatial analysis examines the physical placement of lights along the runway. Correct spacing and alignment are critical for pilot guidance. Irregular spacing or misaligned lights can compromise safety.</div>

<h3>E1. Light Spacing (distance to previous light)</h3>
<div class="desc">Ground distance between each consecutive pair of lights. The blue dashed line shows the median spacing. Runway lights should be evenly spaced. A gap significantly larger than the median suggests a missing or undetected light between those positions. A gap much smaller than expected may indicate a spurious detection.</div>
<div class="cc"><div id="c_spacing" style="height:300px"></div></div>

<h3>E2. Alignment Deviation from Best-Fit Line (m)</h3>
<div class="desc">A polynomial line is fit through all detected light GPS positions. This chart shows how far each light deviates from that best-fit line (in meters). Small deviations (&lt;0.5m) are normal GPS error. Larger deviations suggest a physically displaced light fixture. Positive/negative indicates which side of the line.</div>
<div class="cc"><div id="c_align" style="height:300px"></div></div>

<h3>E3. Flight Path, Light Positions &amp; Missing Lights</h3>
<div class="desc">Geographic map showing the drone's flight path (gray line), detected light positions (dots colored by health score), and any detected missing light locations (red X markers). This provides spatial context for all other analyses. Note: GPS positions are estimated from drone telemetry at the intensity-weighted center frame of each light track.</div>
<div class="cc"><div id="c_map" style="height:500px"></div></div>

<!-- ═══════════ SECTION F: TEMPORAL STABILITY ═══════════ -->
<div class="section"><h2>F. Temporal Stability</h2></div>
<div class="desc">Temporal stability metrics capture how consistently a light performs across frames. A healthy light should produce smooth, predictable intensity changes as the drone passes. Flickering, electrical faults, or loose connections manifest as rapid intensity fluctuations.</div>

<h3>F1. Intensity Coefficient of Variation (lower = more stable)</h3>
<div class="desc">The Coefficient of Variation (CV = standard deviation / mean) of frame-to-frame intensity values during close-range flyover. Lower CV means more stable light output. A high CV suggests the light is flickering or has an unstable power supply. Values below 0.3 are typically normal; above 0.5 warrants investigation.</div>
<div class="cc"><div id="c_cv" style="height:300px"></div></div>

<h3>F2. Frame-to-Frame Intensity Jitter</h3>
<div class="desc">The average absolute change in total intensity between consecutive frames. While CV captures overall variability, this metric specifically targets rapid frame-to-frame fluctuations (flickering). High jitter with low CV could indicate periodic oscillation; high jitter with high CV indicates chaotic instability.</div>
<div class="cc"><div id="c_ftf_jitter" style="height:300px"></div></div>

<h3>F3. Centroid Position Jitter (pixels)</h3>
<div class="desc">Average frame-to-frame displacement of the light's apparent center (centroid) in pixels. A stable light on solid mounting should have minimal centroid movement. High centroid jitter could indicate a loose mounting bracket, vibrating fixture, or thermal shimmer. Values under 2px are normal.</div>
<div class="cc"><div id="c_centroid" style="height:300px"></div></div>

<!-- ═══════════ SECTION G: PHYSICAL APPEARANCE ═══════════ -->
<div class="section"><h2>G. Physical Appearance</h2></div>
<div class="desc">Physical appearance metrics describe how the light looks in the image - its size, shape, clarity, and light scatter. These can reveal issues with the lens, housing, or optical assembly that may not be apparent from intensity alone.</div>

<h3>G1. Apparent Size at ~10m (pixels)</h3>
<div class="desc">The pixel area of the light blob when the drone is approximately 10m away. Consistent sizes confirm uniform fixture design. An unusually small apparent size may indicate a partially blocked or recessed lens; an unusually large size could mean a cracked or missing cover allowing wide-angle scatter.</div>
<div class="cc"><div id="c_size" style="height:300px"></div></div>

<h3>G2. Circularity (1.0 = perfect circle)</h3>
<div class="desc">Circularity measures how close the light blob shape is to a perfect circle (4&pi; &times; area / perimeter&sup2;). A value of 1.0 = perfect circle. Values below 0.7 indicate elongated or irregular shapes, which could be caused by damaged optics, a partially obstructed lens, or a cracked cover. Green = round (good), Red = irregular (investigate).</div>
<div class="cc"><div id="c_circ" style="height:300px"></div></div>

<h3>G3. Halo/Core Ratio (higher = more scattered light)</h3>
<div class="desc">The ratio of dim halo area (pixels above threshold but below 50% peak) to bright core area (pixels above 50% peak). A higher ratio means more light is scattered into a diffuse halo rather than concentrated in the core. This can indicate a dirty, fogged, or moisture-contaminated lens. All lights should have similar ratios.</div>
<div class="cc"><div id="c_halo" style="height:300px"></div></div>

<h3>G4. Edge Sharpness (gradient magnitude at boundary)</h3>
<div class="desc">Average Sobel gradient magnitude at the light's boundary, measuring how sharply the light transitions from bright core to dark background. Sharp edges = clean, well-focused optics. Blurry edges (low gradient) may indicate condensation, surface contamination, or defocused optics.</div>
<div class="cc"><div id="c_edge" style="height:300px"></div></div>

<!-- ═══════════ SECTION H: HEALTH ASSESSMENT ═══════════ -->
<div class="section"><h2>H. Composite Health Assessment</h2></div>
<div class="desc">This section combines all metrics into an overall health assessment. The Z-score heatmap reveals which specific metrics deviate from the group, while the composite health score provides a single 0-100 rating per light for quick identification of problem fixtures.</div>

<h3>H1. Z-Score Heatmap (metric deviations from mean)</h3>
<div class="desc">Each cell shows how many standard deviations a light's metric is from the group mean. Green (Z&asymp;0) = near average, Yellow = moderate deviation, Red (|Z|&gt;2) = significant outlier. Rows are lights, columns are metrics. This is the most powerful diagnostic view: scan for red cells to instantly identify which lights have which problems. A light with multiple red cells across different metrics is likely faulty.</div>
<div class="cc"><div id="c_zscore" style="height:{max(300, N*22+100)}px"></div></div>

<h3>H2. Composite Health Score (0-100)</h3>
<div class="desc">A single score per light combining all metrics. The score starts at 100 and is penalized for Z-score deviations, with higher weights on critical metrics (intensity, FWHM, color). Green dashed line = 80 (good threshold), Orange dashed line = 60 (warning threshold). Lights above 80 are healthy. Lights between 60-80 deserve monitoring. Lights below 60 should be inspected or replaced.</div>
<div class="cc"><div id="c_health" style="height:350px"></div></div>

<h3>H3. Neighbor-Relative Intensity (ratio to avg of neighbors)</h3>
<div class="desc">Each light's peak intensity divided by the average of its immediate neighbors (the lights before and after it). A ratio of 1.0 means the light matches its neighbors. Values below 0.8 indicate a locally dim light; above 1.2 indicates a locally bright light. This metric is robust because it compares each light only to its closest neighbors, removing any systematic gradient along the runway.</div>
<div class="cc"><div id="c_neighbor" style="height:300px"></div></div>

<!-- ═══════════ SECTION I: REFERENCE ═══════════ -->
<div class="section"><h2>I. Reference - Drone Flight Stability</h2></div>
<div class="desc">This section visualizes how the drone's position, orientation, speed, and camera settings changed throughout the flight. Stable, consistent values confirm that measurement conditions were uniform across all lights. Large variations in any parameter may invalidate comparisons between lights measured at different times.</div>

<h3>I1. Drone Altitude Profile</h3>
<div class="desc">Drone's relative altitude (above takeoff point) throughout the video. Stable altitude is essential for valid light comparisons - if altitude varies significantly, distance calculations and apparent brightness will be affected. Look for a flat profile during the measurement segment.</div>
<div class="cc"><div id="c_alt" style="height:300px"></div></div>

<h3>I2. Drone Speed Profile</h3>
<div class="desc">Drone ground speed throughout the video, computed from GPS positions over a 3-second sliding window. Stable speed ensures consistent exposure time per light. Speed variations affect the number of frames captured per light and can bias intensity integral comparisons. Hover shows both m/s and km/h.</div>
<div class="cc"><div id="c_speed" style="height:300px"></div></div>

<h3>I3. Drone Heading (Course Over Ground)</h3>
<div class="desc">Drone's track direction computed from consecutive GPS positions. A straight-line flight should show a constant heading. Deviations indicate turns or lateral drift, which affect the along-track angle calculations and beam pattern analysis. For this runway measurement, the heading should remain stable throughout.</div>
<div class="cc"><div id="c_heading" style="height:300px"></div></div>

<h3>I4. Gimbal Yaw</h3>
<div class="desc">Gimbal yaw (horizontal rotation of the camera in degrees). The gimbal compensates for drone rotation to keep the camera pointing in a consistent direction. Large yaw changes mean the camera's field of view is shifting, which affects which lights are visible and their position in the frame.</div>
<div class="cc"><div id="c_gb_yaw" style="height:300px"></div></div>

<h3>I5. Gimbal Pitch</h3>
<div class="desc">Gimbal pitch (vertical tilt of the camera, degrees). Negative values = camera tilted downward. For consistent runway light measurement, pitch should remain stable. Changes in pitch alter the apparent distance and perspective of lights, affecting intensity measurements.</div>
<div class="cc"><div id="c_gb_pitch" style="height:300px"></div></div>

<h3>I6. Gimbal Roll</h3>
<div class="desc">Gimbal roll (camera rotation around the forward axis, degrees). Should be near 0° for level footage. Non-zero roll means the horizon is tilted in the image, which can shift detected light positions laterally and affect centroid calculations.</div>
<div class="cc"><div id="c_gb_roll" style="height:300px"></div></div>

<h3>I7. Camera ISO &amp; Exposure Value</h3>
<div class="desc">Camera ISO sensitivity and exposure compensation (EV) over time. If the camera uses auto-exposure, ISO or EV changes between light encounters will directly affect measured brightness - brighter lights may simply coincide with higher ISO. Ideally, these should remain constant throughout the measurement flight.</div>
<div class="cc"><div id="c_iso_ev" style="height:300px"></div></div>

<h3>I8. Shutter Speed</h3>
<div class="desc">Camera shutter speed (denominator of 1/x) over time. Faster shutter (higher value) = less light captured per frame = lower measured intensity. If shutter speed changes during the flight, intensity comparisons between lights are invalid. Should remain constant for a controlled measurement.</div>
<div class="cc"><div id="c_shutter" style="height:300px"></div></div>

<h3>I9. Aperture (f-number)</h3>
<div class="desc">Lens aperture (f-number) over time. Lower f-number = wider aperture = more light. Any change in aperture directly scales the brightness of all captured light. For the DJI Matrice 4T the aperture is typically fixed, but this chart confirms it remained constant.</div>
<div class="cc"><div id="c_fnum" style="height:300px"></div></div>

<h3>I10. Focal Length &amp; Digital Zoom</h3>
<div class="desc">Focal length (mm) and digital zoom ratio over time. Changes in focal length alter the field of view and the apparent size/brightness of lights. Digital zoom &gt;1.0 crops and upscales the sensor image, reducing effective resolution. Both should remain constant during measurement.</div>
<div class="cc"><div id="c_focal_zoom" style="height:300px"></div></div>

<h3>I11. Dehaze Level</h3>
<div class="desc">In-camera dehaze processing level over time. Dehaze adjusts contrast and brightness to compensate for atmospheric haze. If enabled (level &gt; 0), it can artificially alter measured light intensity and color. Should be 0 (off) for accurate photometric measurements.</div>
<div class="cc"><div id="c_dehaze" style="height:300px"></div></div>

<h3>I12. Complete Metrics Table</h3>
<div class="desc">All computed metrics for every detected light in tabular form. Rows with red background indicate lights with health score below 60. Columns: Peak Int. = peak total intensity, Dev% = deviation from mean, Integral = total energy, FWHM = beam width, Asym. = asymmetry index, CCT = color temperature, R/G/B = color channels at close range, Int.CV = intensity stability, Jitter = centroid movement, Spacing = distance to previous light, Align = deviation from line, Health = composite score.</div>
<div class="cc" style="overflow-x:auto">
<table><thead><tr>
<th>Light</th><th>Frames</th><th>Frame Range</th><th>Time Range</th>
<th>Peak Int.</th><th>Dev%</th><th>Integral</th><th>FWHM(m)</th>
<th>Asym.</th><th>CCT</th><th>R</th><th>G</th><th>B</th>
<th>Int.CV</th><th>Jitter(px)</th><th>Spacing(m)</th><th>Align(m)</th><th>Health</th>
</tr></thead><tbody>{table_rows}</tbody></table>
</div>

</div><!-- container -->

<script>
var L = {labels_json};

// ── A: Intensity Profile ──
Plotly.newPlot('c_int_dist', {traces_dist("intensities")}, {{
  xaxis:{{title:'Distance (m)',autorange:'reversed'}}, yaxis:{{title:'Total Intensity'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});

Plotly.newPlot('c_norm_beam', {norm_traces_json}, {{
  xaxis:{{title:'Signed distance (m) - positive=approaching'}}, yaxis:{{title:'Normalized Intensity (peak=1.0)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});

Plotly.newPlot('c_peak_bar', [{{x:L, y:{json.dumps(peak_totals)}, type:'bar',
  marker:{{color:{json.dumps(peak_totals)}, colorscale:'YlOrRd', showscale:true}} }}], {{
  yaxis:{{title:'Peak Total Intensity'}},
  shapes:[{{type:'line',x0:-0.5,x1:{N-0.5},y0:{mean_peak},y1:{mean_peak},
    line:{{color:'blue',width:2,dash:'dash'}} }}], margin:{{t:10}} }});

Plotly.newPlot('c_ref_dist', {ref_dist_json}, {{
  barmode:'group', yaxis:{{title:'Intensity at distance'}}, margin:{{t:10}} }});

Plotly.newPlot('c_integral', [{{x:L, y:{bar_vals("intensity_integral")}, type:'bar',
  marker:{{color:'#2ca02c'}} }}], {{ yaxis:{{title:'Intensity Integral'}}, margin:{{t:10}} }});

Plotly.newPlot('c_fwhm', [{{x:L, y:{bar_vals("fwhm")}, type:'bar',
  marker:{{color:'#9467bd'}} }}], {{ yaxis:{{title:'FWHM (m)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_det_range', [{{x:L, y:{bar_vals("max_detection_dist")}, type:'bar',
  marker:{{color:'#17becf'}} }}], {{ yaxis:{{title:'Max Detection Distance (m)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_sat_peak', [
  {{x:L, y:{bar_vals("saturation_onset_dist")}, type:'bar', name:'Saturation onset dist'}},
  {{x:L, y:{bar_vals("distance_at_peak")}, type:'bar', name:'Distance at peak'}}
], {{ barmode:'group', yaxis:{{title:'Distance (m)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_rise_fall', [
  {{x:L, y:{bar_vals("rise_rate")}, type:'bar', name:'Rise rate (approach)', marker:{{color:'#2ca02c'}} }},
  {{x:L, y:{bar_vals("fall_rate")}, type:'bar', name:'Fall rate (departure)', marker:{{color:'#d62728'}} }}
], {{ barmode:'group', yaxis:{{title:'Intensity per meter'}}, margin:{{t:10}} }});

// ── B: Beam Pattern ──
Plotly.newPlot('c_asym', [{{x:L, y:{bar_vals("asymmetry_index")}, type:'bar',
  marker:{{color:'#ff7f0e'}} }}], {{
  yaxis:{{title:'Asymmetry Index (approach/departure)'}},
  shapes:[{{type:'line',x0:-0.5,x1:{N-0.5},y0:1,y1:1,
    line:{{color:'red',width:1,dash:'dot'}} }}], margin:{{t:10}} }});

Plotly.newPlot('c_elev', [{{x:L, y:{bar_vals("beam_elevation_angle")}, type:'bar',
  marker:{{color:'#8c564b'}} }}], {{ yaxis:{{title:'Elevation Angle (deg)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_sigma', [{{x:L, y:{bar_vals("gaussian_sigma")}, type:'bar',
  marker:{{color:'#e377c2'}} }}], {{ yaxis:{{title:'Gaussian Sigma (m)'}}, margin:{{t:10}} }});

// ── C: Color ──
Plotly.newPlot('c_red', {traces_dist("r","#cc0000")}, {{
  xaxis:{{title:'Distance (m)',autorange:'reversed'}}, yaxis:{{title:'Red (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_green', {traces_dist("g","#00aa00")}, {{
  xaxis:{{title:'Distance (m)',autorange:'reversed'}}, yaxis:{{title:'Green (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_blue', {traces_dist("b","#0000cc")}, {{
  xaxis:{{title:'Distance (m)',autorange:'reversed'}}, yaxis:{{title:'Blue (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});

Plotly.newPlot('c_cie', [{{
  x:{json.dumps(cie_xs)}, y:{json.dumps(cie_ys)},
  mode:'markers+text', text:L, textposition:'top center', textfont:{{size:9}},
  marker:{{size:12, color:{json.dumps(health_scores)}, colorscale:'RdYlGn',
    showscale:true, colorbar:{{title:'Health'}}, line:{{color:'black',width:1}} }},
  hovertemplate:'%{{text}}<br>x=%{{x:.4f}}<br>y=%{{y:.4f}}<extra></extra>'
}}], {{
  xaxis:{{title:'CIE x', range:[0.25,0.45]}}, yaxis:{{title:'CIE y', range:[0.25,0.45]}},
  margin:{{t:10}} }});

Plotly.newPlot('c_cct', [{{x:L, y:{bar_vals("cct")}, type:'bar',
  marker:{{color:{bar_vals("cct")}, colorscale:'Plasma', showscale:true}} }}],
  {{ yaxis:{{title:'CCT (K)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_color_ratio', [
  {{x:L, y:{bar_vals("r_ratio")}, type:'bar', name:'R fraction', marker:{{color:'#cc0000'}}}},
  {{x:L, y:{bar_vals("g_ratio")}, type:'bar', name:'G fraction', marker:{{color:'#00aa00'}}}},
  {{x:L, y:{bar_vals("b_ratio")}, type:'bar', name:'B fraction', marker:{{color:'#0000cc'}}}}
], {{ barmode:'stack', yaxis:{{title:'Fraction'}}, margin:{{t:10}} }});

Plotly.newPlot('c_rgb_bar', [
  {{x:L, y:{bar_vals("close_mean_r")}, type:'bar', name:'Red', marker:{{color:'#cc0000'}}}},
  {{x:L, y:{bar_vals("close_mean_g")}, type:'bar', name:'Green', marker:{{color:'#00aa00'}}}},
  {{x:L, y:{bar_vals("close_mean_b")}, type:'bar', name:'Blue', marker:{{color:'#0000cc'}}}}
], {{ barmode:'group', yaxis:{{title:'Mean channel (0-255)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_color_std', [
  {{x:L, y:{bar_vals("color_std_r")}, type:'bar', name:'R std', marker:{{color:'#cc0000'}}}},
  {{x:L, y:{bar_vals("color_std_g")}, type:'bar', name:'G std', marker:{{color:'#00aa00'}}}},
  {{x:L, y:{bar_vals("color_std_b")}, type:'bar', name:'B std', marker:{{color:'#0000cc'}}}}
], {{ barmode:'group', yaxis:{{title:'Std deviation (0-255)'}}, margin:{{t:10}} }});

// ── D: Time-based ──
Plotly.newPlot('c_int_time', {traces_time("intensities")}, {{
  xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Total Intensity'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_r_time', {traces_time("r","#cc0000")}, {{
  xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Red (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_g_time', {traces_time("g","#00aa00")}, {{
  xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Green (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_b_time', {traces_time("b","#0000cc")}, {{
  xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Blue (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});

// ── D+: Angular ──
Plotly.newPlot('c_int_hang', {traces_hangle("intensities")}, {{
  xaxis:{{title:'Along-track angle (°)'}}, yaxis:{{title:'Total Intensity'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_int_vang', {traces_vangle("intensities")}, {{
  xaxis:{{title:'Vertical angle / elevation (°)'}}, yaxis:{{title:'Total Intensity'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_r_hang', {traces_hangle("r","#cc0000")}, {{
  xaxis:{{title:'Along-track angle (°)'}}, yaxis:{{title:'Red (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_g_hang', {traces_hangle("g","#00aa00")}, {{
  xaxis:{{title:'Along-track angle (°)'}}, yaxis:{{title:'Green (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_b_hang', {traces_hangle("b","#0000cc")}, {{
  xaxis:{{title:'Along-track angle (°)'}}, yaxis:{{title:'Blue (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_r_vang', {traces_vangle("r","#cc0000")}, {{
  xaxis:{{title:'Vertical angle / elevation (°)'}}, yaxis:{{title:'Red (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_g_vang', {traces_vangle("g","#00aa00")}, {{
  xaxis:{{title:'Vertical angle / elevation (°)'}}, yaxis:{{title:'Green (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});
Plotly.newPlot('c_b_vang', {traces_vangle("b","#0000cc")}, {{
  xaxis:{{title:'Vertical angle / elevation (°)'}}, yaxis:{{title:'Blue (0-255)'}},
  hovermode:'closest', legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}} }});

// ── E: Spatial ──
Plotly.newPlot('c_spacing', [{{x:L, y:{json.dumps(spacings)}, type:'bar',
  marker:{{color:{json.dumps(spacings)}, colorscale:'RdYlGn_r', showscale:true}} }}], {{
  yaxis:{{title:'Spacing to previous (m)'}},
  shapes:[{{type:'line',x0:-0.5,x1:{N-0.5},y0:{median_spacing},y1:{median_spacing},
    line:{{color:'blue',width:2,dash:'dash'}} }}],
  annotations:[{{x:{N-1},y:{median_spacing},text:'Median: {median_spacing:.1f}m',
    showarrow:false,yshift:15,font:{{color:'blue'}} }}], margin:{{t:10}} }});

Plotly.newPlot('c_align', [{{x:L, y:{json.dumps(alignment_devs)}, type:'bar',
  marker:{{color:{json.dumps([abs(a) for a in alignment_devs])}, colorscale:'Reds', showscale:true}} }}],
  {{ yaxis:{{title:'Deviation from line (m)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_map', [
  {{x:{json.dumps(gps_lons)}, y:{json.dumps(gps_lats)}, mode:'lines',
    name:'Flight path', line:{{color:'#999',width:2}} }},
  {{x:{json.dumps(light_lons)}, y:{json.dumps(light_lats)}, mode:'markers+text',
    name:'Detected lights', text:{labels_json}, textposition:'top center', textfont:{{size:9}},
    marker:{{size:10,color:{json.dumps(health_scores)},colorscale:'RdYlGn',
      showscale:true,colorbar:{{title:'Health'}},line:{{color:'black',width:1}} }} }},
  {{x:{json.dumps(ml_lons)}, y:{json.dumps(ml_lats)}, mode:'markers+text',
    name:'Missing lights', text:{json.dumps(ml_labels)}, textposition:'bottom center',
    textfont:{{size:8,color:'red'}},
    marker:{{size:14,color:'red',symbol:'x',line:{{color:'darkred',width:2}} }} }}
], {{
  xaxis:{{title:'Longitude',scaleanchor:'y',scaleratio:1/Math.cos({gps_frames[0].latitude}*Math.PI/180)}},
  yaxis:{{title:'Latitude'}}, hovermode:'closest', margin:{{t:10}} }});

// ── F: Temporal Stability ──
Plotly.newPlot('c_cv', [{{x:L, y:{bar_vals("intensity_cv")}, type:'bar',
  marker:{{color:{bar_vals("intensity_cv")}, colorscale:'Reds', showscale:true}} }}],
  {{ yaxis:{{title:'Coefficient of Variation'}}, margin:{{t:10}} }});

Plotly.newPlot('c_ftf_jitter', [{{x:L, y:{bar_vals("frame_to_frame_jitter")}, type:'bar',
  marker:{{color:'#bcbd22'}} }}], {{ yaxis:{{title:'Mean frame-to-frame change'}}, margin:{{t:10}} }});

Plotly.newPlot('c_centroid', [{{x:L, y:{bar_vals("centroid_jitter")}, type:'bar',
  marker:{{color:{bar_vals("centroid_jitter")}, colorscale:'Reds', showscale:true}} }}],
  {{ yaxis:{{title:'Centroid Jitter (pixels)'}}, margin:{{t:10}} }});

// ── G: Physical Appearance ──
Plotly.newPlot('c_size', [{{x:L, y:{bar_vals("apparent_size_at_10m")}, type:'bar',
  marker:{{color:'#17becf'}} }}], {{ yaxis:{{title:'Apparent size (pixels)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_circ', [{{x:L, y:{bar_vals("mean_circularity")}, type:'bar',
  marker:{{color:{bar_vals("mean_circularity")}, colorscale:'RdYlGn', showscale:true}} }}],
  {{ yaxis:{{title:'Circularity (1.0=circle)', range:[0,1]}}, margin:{{t:10}} }});

Plotly.newPlot('c_halo', [{{x:L, y:{bar_vals("halo_ratio")}, type:'bar',
  marker:{{color:{bar_vals("halo_ratio")}, colorscale:'Reds', showscale:true}} }}],
  {{ yaxis:{{title:'Halo/Core area ratio'}}, margin:{{t:10}} }});

Plotly.newPlot('c_edge', [{{x:L, y:{bar_vals("mean_edge_sharpness")}, type:'bar',
  marker:{{color:'#8c564b'}} }}], {{ yaxis:{{title:'Mean edge gradient'}}, margin:{{t:10}} }});

// ── H: Health Assessment ──
Plotly.newPlot('c_zscore', [{{
  z: {json.dumps(z_matrix)},
  x: {json.dumps(z_metric_labels)},
  y: L,
  type: 'heatmap',
  colorscale: [[0,'#2ca02c'],[0.25,'#98df8a'],[0.5,'#ffffcc'],[0.75,'#ff9896'],[1,'#d62728']],
  zmid: 0, zmin:-3, zmax:3,
  hovertemplate: '%{{y}}<br>%{{x}}<br>Z=%{{z:.2f}}<extra></extra>',
  colorbar:{{title:'Z-score'}}
}}], {{ margin:{{t:10,l:80}}, yaxis:{{autorange:'reversed'}} }});

Plotly.newPlot('c_health', [{{x:L, y:{json.dumps([round(s,1) for s in health_scores])},
  type:'bar', marker:{{color:{json.dumps(health_colors)}}},
  text:{json.dumps([f'{s:.0f}' for s in health_scores])}, textposition:'outside' }}], {{
  yaxis:{{title:'Health Score (0-100)', range:[0,110]}},
  shapes:[{{type:'line',x0:-0.5,x1:{N-0.5},y0:60,y1:60,
    line:{{color:'orange',width:1,dash:'dot'}} }},
    {{type:'line',x0:-0.5,x1:{N-0.5},y0:80,y1:80,
    line:{{color:'green',width:1,dash:'dot'}} }}],
  margin:{{t:10}} }});

Plotly.newPlot('c_neighbor', [{{x:L, y:{bar_vals("neighbor_relative_intensity")}, type:'bar',
  marker:{{color:{bar_vals("neighbor_relative_intensity")}, colorscale:'RdYlGn',
    cmid:1, showscale:true}} }}], {{
  yaxis:{{title:'Ratio to neighbor average (1.0 = normal)'}},
  shapes:[{{type:'line',x0:-0.5,x1:{N-0.5},y0:1,y1:1,
    line:{{color:'blue',width:1,dash:'dot'}} }}], margin:{{t:10}} }});

// ── I: Reference ──
Plotly.newPlot('c_alt', [{{
  x:{json.dumps(gps_times)}, y:{json.dumps(gps_alts)},
  mode:'lines', line:{{color:'#16213e',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>Alt: %{{y:.2f}}m<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Relative altitude (m)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_speed', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_speeds_ms)},
  mode:'lines', line:{{color:'#d62728',width:2}}, name:'Speed',
  hovertemplate:'Time: %{{x:.1f}}s<br>Speed: %{{y:.1f}} m/s (%{{customdata:.1f}} km/h)<extra></extra>',
  customdata:{json.dumps([round(s*3.6, 1) for s in gps_speeds_ms])}
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Speed (m/s)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_heading', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_headings)},
  mode:'lines', line:{{color:'#9467bd',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>Heading: %{{y:.1f}}°<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Heading (°)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_gb_yaw', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_gb_yaws)},
  mode:'lines', line:{{color:'#ff7f0e',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>Gimbal Yaw: %{{y:.1f}}°<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Gimbal Yaw (°)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_gb_pitch', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_gb_pitches)},
  mode:'lines', line:{{color:'#2ca02c',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>Gimbal Pitch: %{{y:.1f}}°<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Gimbal Pitch (°)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_gb_roll', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_gb_rolls)},
  mode:'lines', line:{{color:'#17becf',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>Gimbal Roll: %{{y:.2f}}°<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Gimbal Roll (°)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_iso_ev', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_isos)},
  mode:'lines', line:{{color:'#8c564b',width:2}}, name:'ISO',
  yaxis:'y'
}}, {{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_evs)},
  mode:'lines', line:{{color:'#e377c2',width:2}}, name:'EV',
  yaxis:'y2'
}}], {{
  xaxis:{{title:'Video time (s)'}},
  yaxis:{{title:'ISO', side:'left'}},
  yaxis2:{{title:'EV', side:'right', overlaying:'y'}},
  legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}}
}});

Plotly.newPlot('c_shutter', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_shutter_vals)},
  mode:'lines', line:{{color:'#1f77b4',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>Shutter: 1/%{{y:.0f}}s<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Shutter speed (1/x)'}}, margin:{{t:10}} }});

Plotly.newPlot('c_fnum', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_fnums)},
  mode:'lines', line:{{color:'#ff7f0e',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>f/%{{y:.1f}}<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'f-number'}}, margin:{{t:10}} }});

Plotly.newPlot('c_focal_zoom', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_focals)},
  mode:'lines', line:{{color:'#2ca02c',width:2}}, name:'Focal length (mm)',
  yaxis:'y'
}}, {{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_dzooms)},
  mode:'lines', line:{{color:'#d62728',width:2}}, name:'Digital zoom ratio',
  yaxis:'y2'
}}], {{
  xaxis:{{title:'Video time (s)'}},
  yaxis:{{title:'Focal length (mm)', side:'left'}},
  yaxis2:{{title:'Digital zoom ratio', side:'right', overlaying:'y'}},
  legend:{{orientation:'h',y:-0.2}}, margin:{{t:10}}
}});

Plotly.newPlot('c_dehaze', [{{
  x:{json.dumps(gps_speed_times)}, y:{json.dumps(gps_dehaze_lvls)},
  mode:'lines', line:{{color:'#9467bd',width:2}},
  hovertemplate:'Time: %{{x:.1f}}s<br>Dehaze level: %{{y}}<extra></extra>'
}}], {{ xaxis:{{title:'Video time (s)'}}, yaxis:{{title:'Dehaze level'}}, margin:{{t:10}} }});
</script>
</body></html>"""

    with open(OUTPUT_HTML, 'w') as f:
        f.write(html)

if __name__ == "__main__":
    process_video()
