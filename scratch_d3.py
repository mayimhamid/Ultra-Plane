p = r"E:\Code archives\palne\plane\apps\api\plane\tests\contract\app\test_team_ops_workday_day.py"
s = open(p, newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"


def rep(a, b):
    global s
    a = a.replace("\n", nl)
    b = b.replace("\n", nl)
    assert a in s, a[:80]
    s = s.replace(a, b, 1)


rep(
    '@pytest.mark.parametrize("mode", ["REMOTE", "ONSITE", "HYBRID"])\n    def test_modes_are_saved_and_can_change',
    '@pytest.mark.parametrize("mode", ["REMOTE", "ONSITE"])\n    def test_modes_are_saved',
)
rep(
    "    def test_a_hybrid_day_still_needs_a_place_for_each_task(self, member_client, workspace, issue):\n        set_mode(member_client, workspace, \"HYBRID\")\n",
    '''    def test_the_answer_cannot_be_changed_from_the_top_of_the_page(self, member_client, workspace):
        set_mode(member_client, workspace, "REMOTE")
        assert set_mode(member_client, workspace, "REMOTE").status_code == status.HTTP_200_OK
        assert set_mode(member_client, workspace, "ONSITE").status_code == status.HTTP_400_BAD_REQUEST
        assert set_mode(member_client, workspace, "HYBRID").status_code == status.HTTP_400_BAD_REQUEST
        assert WorkDay.objects.get().mode == "REMOTE"

    def test_a_hybrid_day_still_needs_a_place_for_each_task(self, member_client, workspace, issue, member):
        WorkDay.objects.create(workspace=workspace, user=member, date=timezone.now().date(), mode="HYBRID")
''',
)
rep(
    '        set_mode(member_client, workspace, "HYBRID")\n        start(member_client, workspace, issue, location="ONSITE")',
    '        set_mode(member_client, workspace, "REMOTE")\n        start(member_client, workspace, issue, location="ONSITE")',
)
open(p, "w", newline="").write(s)
print("ok")
