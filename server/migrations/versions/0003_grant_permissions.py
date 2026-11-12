"""Add granular permissions to document grants.

Revision ID: 0003_grant_permissions
Revises: 0002_admin_role
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_grant_permissions"
down_revision = "0002_admin_role"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("document_grants", sa.Column("can_view", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("document_grants", sa.Column("can_download", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("document_grants", sa.Column("can_share", sa.Boolean(), nullable=False, server_default=sa.false()))

def downgrade():
    op.drop_column("document_grants", "can_share")
    op.drop_column("document_grants", "can_download")
    op.drop_column("document_grants", "can_view")
