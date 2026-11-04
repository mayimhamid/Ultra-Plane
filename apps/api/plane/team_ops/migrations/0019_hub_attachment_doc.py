import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("team_ops", "0018_opsnotification_new_kinds"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="hubattachment",
            name="tops_hub_attachment_has_owner",
        ),
        migrations.AddField(
            model_name="hubattachment",
            name="doc",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="files",
                to="team_ops.hubdoc",
            ),
        ),
        migrations.AddConstraint(
            model_name="hubattachment",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("message__isnull", False),
                    ("session__isnull", False),
                    ("doc__isnull", False),
                    ("library", True),
                    _connector="OR",
                ),
                name="tops_hub_attachment_has_owner",
            ),
        ),
    ]
