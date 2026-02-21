"""remove daily message limit

Revision ID: 07e98c2909c8
Revises: cd67425061c4
Create Date: 2026-02-21 05:08:48.570417

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '07e98c2909c8'
down_revision: Union[str, None] = 'cd67425061c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('users', 'daily_message_limit')


def downgrade() -> None:
    op.add_column(
        'users',
        sa.Column('daily_message_limit', sa.Integer(), nullable=True),
    )
