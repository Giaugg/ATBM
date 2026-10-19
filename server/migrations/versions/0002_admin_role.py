"""Add persisted administrator role to users.

Revision ID: 0002_admin_role
Revises: 0001_initial
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_admin_role"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column("users", "is_admin")