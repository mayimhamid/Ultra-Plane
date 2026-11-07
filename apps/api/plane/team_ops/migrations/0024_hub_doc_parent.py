import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("team_ops", "0023_hub_secrets_e2e"),
    ]

    operations = [
        migrations.AddField(
            model_name="hubdoc",
            name="parent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="children",
                to="team_ops.hubdoc",
            ),
        ),
    ]
