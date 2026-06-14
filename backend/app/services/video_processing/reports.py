"""
PAPI report generation module
"""
import os
from datetime import datetime
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.offline as pyo
from app.core.logging import logger
import numpy as np
import json
import math
from typing import Dict, List, Optional, Tuple
from pathlib import Path



class PAPIReportGenerator:
    """Generate comprehensive HTML reports for PAPI measurements"""
    
    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
    
    def generate_html_report(self, session_data: Dict, measurements: List[Dict], video_paths: Dict[str, str] = None, reference_points: Dict = None, enhanced_main_video_path: str = None) -> str:
        """Generate interactive HTML report with Plotly charts, embedded videos, and reference point coordinates"""
        try:
            # Organize data by PAPI light
            papi_data = {}
            timestamps = []
            
            for measurement in measurements:
                timestamp = measurement.get('timestamp', 0)
                timestamps.append(timestamp / 1000)  # Convert to seconds
                
                for papi_id in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
                    if papi_id not in papi_data:
                        papi_data[papi_id] = {
                            'r_values': [],
                            'g_values': [],
                            'b_values': [],
                            'status': [],
                            'intensity': [],
                            'angles': [],
                            'ground_distance': []
                        }
                    
                    if papi_id in measurement:
                        data = measurement[papi_id]
                        rgb = data.get('rgb', {'r': 0, 'g': 0, 'b': 0})
                        
                        papi_data[papi_id]['r_values'].append(rgb['r'])
                        papi_data[papi_id]['g_values'].append(rgb['g'])
                        papi_data[papi_id]['b_values'].append(rgb['b'])
                        papi_data[papi_id]['status'].append(data.get('status', 'not_visible'))
                        papi_data[papi_id]['intensity'].append(data.get('intensity', 0))
                        papi_data[papi_id]['angles'].append(data.get('angle', 0))
                        papi_data[papi_id]['ground_distance'].append(data.get('distance_ground', 0))
            
            # Generate HTML with interactive charts and videos
            html_content = self._create_html_template(
                session_data, papi_data, timestamps, video_paths or {}, 
                reference_points or {}, enhanced_main_video_path
            )
            
            # Save report
            report_filename = f"papi_report_{session_data.get('session_id', 'unknown')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
            report_path = os.path.join(self.output_dir, report_filename)
            
            with open(report_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            
            logger.info(f"HTML report generated: {report_path}")
            return report_path
            
        except Exception as e:
            logger.error(f"Error generating HTML report: {e}")
            return ""
    
    def _create_html_template(self, session_data: Dict, papi_data: Dict, timestamps: List[float], video_paths: Dict[str, str], reference_points: Dict, enhanced_main_video_path: str = None) -> str:
        """Create HTML template with Plotly charts, embedded videos, and reference point coordinates"""
        
        # Create individual charts for each PAPI light
        charts_html = ""
        
        for papi_id in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
            if papi_id in papi_data and papi_data[papi_id]['r_values']:
                data = papi_data[papi_id]
                
                # Create RGB + Angle chart
                fig = make_subplots(
                    rows=2, cols=1,
                    subplot_titles=(f'{papi_id} RGB Values', f'{papi_id} Angle & Distances'),
                    vertical_spacing=0.1
                )
                
                # RGB traces
                fig.add_trace(go.Scatter(x=timestamps, y=data['r_values'], name='Red', 
                                       line=dict(color='red')), row=1, col=1)
                fig.add_trace(go.Scatter(x=timestamps, y=data['g_values'], name='Green',
                                       line=dict(color='green')), row=1, col=1)
                fig.add_trace(go.Scatter(x=timestamps, y=data['b_values'], name='Blue',
                                       line=dict(color='blue')), row=1, col=1)
                
                # Angle and distance traces
                fig.add_trace(go.Scatter(x=timestamps, y=data['angles'], name='Angle (degrees)',
                                       line=dict(color='purple')), row=2, col=1)
                fig.add_trace(go.Scatter(x=timestamps, y=data['ground_distance'], name='Ground Distance (m)',
                                       line=dict(color='orange')), row=2, col=1)
                
                fig.update_layout(
                    title=f'{papi_id} Analysis',
                    height=600,
                    showlegend=True
                )
                fig.update_xaxes(title_text="Time (seconds)")
                fig.update_yaxes(title_text="RGB Value", row=1, col=1)
                fig.update_yaxes(title_text="Angle (deg) / Distance (m)", row=2, col=1)
                
                chart_html = pyo.plot(fig, output_type='div', include_plotlyjs=False)
                
                # Add video player if video exists for this PAPI light
                video_html = ""
                if papi_id in video_paths and video_paths[papi_id]:
                    # Use API endpoint for video src with full hostname
                    light_name = papi_id.lower()  # papi_a, papi_b, etc.
                    # Import settings here to get the configured base URL
                    from app.core.config import settings
                    video_src = f"{settings.API_BASE_URL}/api/v1/papi-measurements/session/{session_data.get('session_id')}/papi-video/{light_name}"
                    video_html = f'''
                    <div class="video-container">
                        <h4>{papi_id} Light Video</h4>
                        <video width="400" height="300" controls>
                            <source src="{video_src}" type="video/mp4">
                            Your browser does not support the video tag.
                        </video>
                        <p class="video-description">
                            This video shows the {papi_id} light throughout the measurement flight.
                            The crosshair marks the light position and frame numbers are displayed.
                        </p>
                    </div>
                    '''
                
                # Add reference point coordinates if available
                coordinates_html = ""
                if papi_id in reference_points:
                    coords = reference_points[papi_id]
                    coordinates_html = f'''
                    <div class="coordinates-info">
                        <h5>📍 Reference Point Coordinates</h5>
                        <div class="coord-grid">
                            <div class="coord-item">
                                <span class="coord-label">Latitude:</span>
                                <span class="coord-value">{coords.get('latitude', 'N/A')}°</span>
                            </div>
                            <div class="coord-item">
                                <span class="coord-label">Longitude:</span>
                                <span class="coord-value">{coords.get('longitude', 'N/A')}°</span>
                            </div>
                            <div class="coord-item">
                                <span class="coord-label">Elevation:</span>
                                <span class="coord-value">{coords.get('elevation', 'N/A')} m</span>
                            </div>
                        </div>
                    </div>
                    '''
                
                # Combine chart, video, and coordinates in a layout
                charts_html += f'''
                <div class="papi-section">
                    <h3>{papi_id} Analysis</h3>
                    {coordinates_html}
                    <div class="chart-video-container">
                        <div class="chart-container">{chart_html}</div>
                        {video_html}
                    </div>
                </div>
                '''
        
        # Create summary statistics
        summary_html = self._create_summary_table(papi_data, timestamps)
        
        # Create reference points summary (including touch point)
        reference_points_html = self._create_reference_points_table(reference_points)
        
        html_template = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>PAPI Measurement Report - {session_data.get('session_id', 'Unknown')}</title>
            <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }}
                .header {{ background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }}
                .papi-section {{ background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }}
                .chart-video-container {{ display: flex; gap: 20px; align-items: flex-start; }}
                .chart-container {{ flex: 2; min-width: 0; }}
                .video-container {{ flex: 1; min-width: 300px; }}
                .video-container h4 {{ margin-top: 0; color: #333; }}
                .video-container video {{ width: 100%; height: auto; border-radius: 8px; }}
                .video-description {{ font-size: 12px; color: #666; margin-top: 10px; }}
                .coordinates-info {{ background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #007bff; }}
                .coordinates-info h5 {{ margin: 0 0 10px 0; color: #333; font-size: 14px; }}
                .coord-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }}
                .coord-item {{ display: flex; justify-content: space-between; padding: 5px 0; }}
                .coord-label {{ font-weight: bold; color: #666; }}
                .coord-value {{ color: #333; font-family: monospace; }}
                .summary {{ background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }}
                table {{ width: 100%; border-collapse: collapse; }}
                th, td {{ border: 1px solid #ddd; padding: 8px; text-align: center; }}
                th {{ background-color: #4CAF50; color: white; }}
                .status-red {{ background-color: #ffebee; }}
                .status-white {{ background-color: #f3f3f3; }}
                .status-transition {{ background-color: #fff3e0; }}
                .status-not_visible {{ background-color: #fafafa; }}
                @media (max-width: 768px) {{
                    .chart-video-container {{ flex-direction: column; }}
                    .video-container {{ min-width: auto; }}
                }}
                .reference-points-section {{ background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }}
                .reference-points-section h3 {{ margin-top: 0; color: #333; font-size: 18px; }}
                .reference-table {{ width: 100%; border-collapse: collapse; margin-top: 15px; }}
                .reference-table th {{ background-color: #007bff; color: white; padding: 12px 8px; }}
                .reference-table td {{ padding: 10px 8px; border: 1px solid #ddd; }}
                .reference-table tr:nth-child(even) {{ background-color: #f8f9fa; }}
                .reference-table tr:hover {{ background-color: #e9ecef; }}
                .original-video-section {{ background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }}
                .original-video-section h2 {{ margin-top: 0; color: #333; }}
                .original-video-container {{ text-align: center; }}
                .original-video-container video {{ border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); }}
            </style>
        </head>
        <body>
            <div class="header">
                <h1>🛩️ PAPI Light Measurement Report</h1>
                <p><strong>Session ID:</strong> {session_data.get('session_id', 'Unknown')}</p>
                <p><strong>Airport:</strong> {session_data.get('airport_icao', 'Unknown')}</p>
                <p><strong>Runway:</strong> {session_data.get('runway_code', 'Unknown')}</p>
                <p><strong>Generated:</strong> {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
                <p><strong>Total Frames Analyzed:</strong> {len(timestamps)}</p>
                <p><strong>Duration:</strong> {max(timestamps) - min(timestamps):.1f} seconds</p>
            </div>
            
            <div class="original-video-section">
                <h2>🎥 Enhanced Analysis Video</h2>
                <div class="original-video-container">
                    <video width="800" height="600" controls>
                        <source src="{self._get_enhanced_video_url(session_data.get('session_id'), enhanced_main_video_path)}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                    <p class="video-description">
                        Enhanced video with real-time drone position information (latitude, longitude, elevation), 
                        PAPI light status rectangles, angles to each PAPI light and touch point, and frame progress. 
                        The rectangles change color based on light status: Red for red lights, White for white lights, 
                        Orange for transition, Gray for not visible. Angle measurements show elevation angles from 
                        drone to each target with distance information.
                    </p>
                </div>
            </div>
            
            <div class="summary">
                <h2>📊 Summary Statistics</h2>
                {summary_html}
            </div>
            
            {reference_points_html}
            
            <div class="charts">
                <h2>📈 Detailed Analysis</h2>
                {charts_html}
            </div>
        </body>
        </html>
        """
        
        return html_template
    
    def _get_enhanced_video_url(self, session_id: str, enhanced_main_video_path: str) -> str:
        """Get URL for enhanced video or fallback to original video"""
        from app.core.config import settings
        
        if enhanced_main_video_path and os.path.exists(enhanced_main_video_path):
            # Use enhanced video endpoint (we'll create this)
            return f"{settings.API_BASE_URL}/api/v1/papi-measurements/session/{session_id}/enhanced-video"
        else:
            # Fallback to original video
            return f"{settings.API_BASE_URL}/api/v1/papi-measurements/session/{session_id}/original-video"
    
    def _create_summary_table(self, papi_data: Dict, timestamps: List[float]) -> str:
        """Create summary statistics table"""
        summary_rows = ""
        
        for papi_id in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
            if papi_id in papi_data and papi_data[papi_id]['status']:
                data = papi_data[papi_id]
                
                # Calculate statistics
                status_counts = {}
                for status in data['status']:
                    status_counts[status] = status_counts.get(status, 0) + 1
                
                avg_intensity = sum(data['intensity']) / len(data['intensity']) if data['intensity'] else 0
                avg_angle = sum(data['angles']) / len(data['angles']) if data['angles'] else 0
                avg_distance = sum(data['ground_distance']) / len(data['ground_distance']) if data['ground_distance'] else 0
                
                summary_rows += f"""
                <tr>
                    <td><strong>{papi_id}</strong></td>
                    <td>{len(data['status'])}</td>
                    <td>{status_counts.get('red', 0)}</td>
                    <td>{status_counts.get('white', 0)}</td>
                    <td>{status_counts.get('transition', 0)}</td>
                    <td>{status_counts.get('not_visible', 0)}</td>
                    <td>{avg_intensity:.1f}</td>
                    <td>{avg_angle:.2f}°</td>
                    <td>{avg_distance:.1f}m</td>
                </tr>
                """
        
        return f"""
        <table>
            <tr>
                <th>PAPI Light</th>
                <th>Total Frames</th>
                <th>Red Frames</th>
                <th>White Frames</th>
                <th>Transition Frames</th>
                <th>Not Visible</th>
                <th>Avg Intensity</th>
                <th>Avg Angle</th>
                <th>Avg Distance</th>
            </tr>
            {summary_rows}
        </table>
        """

    def _create_reference_points_table(self, reference_points: Dict) -> str:
        """Create reference points table including PAPI lights and touch point coordinates"""
        if not reference_points:
            return '<p style="color: #666; font-style: italic;">No reference point data available.</p>'
        
        reference_rows = ""
        
        # Add PAPI light coordinates
        for papi_id in ['PAPI_A', 'PAPI_B', 'PAPI_C', 'PAPI_D']:
            if papi_id in reference_points:
                coords = reference_points[papi_id]
                lat = coords.get('latitude', 'N/A')
                lon = coords.get('longitude', 'N/A') 
                elev = coords.get('elevation', 'N/A')
                
                reference_rows += f"""
                <tr>
                    <td><strong>{papi_id}</strong></td>
                    <td>PAPI Light</td>
                    <td>{lat}°</td>
                    <td>{lon}°</td>
                    <td>{elev} m</td>
                </tr>
                """
        
        # Add touch point coordinates  
        if 'touch_point' in reference_points:
            coords = reference_points['touch_point']
            lat = coords.get('latitude', 'N/A')
            lon = coords.get('longitude', 'N/A')
            elev = coords.get('elevation', 'N/A')
            
            reference_rows += f"""
            <tr>
                <td><strong>Touch Point</strong></td>
                <td>Runway Touch Point</td>
                <td>{lat}°</td>
                <td>{lon}°</td>
                <td>{elev} m</td>
            </tr>
            """
        
        return f"""
        <div class="reference-points-section">
            <h3>🗺️ Reference Points & Coordinates</h3>
            <table class="reference-table">
                <thead>
                    <tr>
                        <th>Point Name</th>
                        <th>Type</th>
                        <th>Latitude</th>
                        <th>Longitude</th>
                        <th>Elevation</th>
                    </tr>
                </thead>
                <tbody>
                    {reference_rows}
                </tbody>
            </table>
        </div>
        """
