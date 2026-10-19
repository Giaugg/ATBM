from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://vaultshare:vaultshare_dev@localhost:5432/vaultshare"
    jwt_secret: str = "development-only-change-me"
    admin_bootstrap_token: str = ""
    access_token_minutes: int = 60
    storage_path: str = "./storage"
    max_upload_bytes: int = 104857600
    cors_origins: str = "http://localhost:3000"
    seed_demo_users: bool = False
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
