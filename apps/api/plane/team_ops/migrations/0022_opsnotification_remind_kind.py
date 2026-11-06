from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("team_ops", "0021_day_report_times_place"),
    ]

    operations = [
        migrations.AlterField(
            model_name="opsnotification",
            name="kind",
            field=models.CharField(
                choices=[
                    ("MENTION", "Mention"),
                    ("ATTENTION", "Needs attention"),
                    ("FREEZE", "Freeze"),
                    ("NEWS", "News"),
                    ("DIRECT", "Direct message"),
                    ("SECRET", "Secret shared"),
                    ("FLOW", "Added to a flow"),
                    ("REPLY", "Reply"),
                    ("ASSIGN", "Assigned a task"),
                    ("CHECKIN", "Check-in due"),
                    ("LEAVE", "Leave request"),
                    ("REPORT", "Day report changed"),
                    ("REMIND", "Log your tasks"),
                ],
                max_length=10,
            ),
        ),
    ]
