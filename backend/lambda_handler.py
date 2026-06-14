"""AWS Lambda entrypoint: wraps the FastAPI app with Mangum."""

from mangum import Mangum

from app.main import app

# lifespan off - lambda has no long-lived process to run startup/shutdown hooks
handler = Mangum(app, lifespan="off")
