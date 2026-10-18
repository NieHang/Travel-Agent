"""Placeholder: route lookup between two places in Japan. Not implemented and not exposed to the model.

Planned use: the backend runs this script as a subprocess and returns its output as a tool result,
so routes can be grounded like hotel results instead of estimated by the model.

Planned JSON on stdin:
    {"from": "Ueno Station", "to": "Senso-ji", "departAt": "2026-12-01T17:00"}
Planned JSON on stdout:
    {"legs": [{"mode": "subway", "line": "Ginza Line", "minutes": 5, "transfers": 0}], "source": "<provider>"}
"""

raise SystemExit("not implemented")
