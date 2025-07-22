import csv
import json

csv_file = "input.csv"
json_file = "output.json"

# CSV fields to include but with possible renaming in JSON output
# Format: csv_field_name: json_field_name
field_mapping = {
    "ID": "id",
    "Rank": "rank",
    "Level": "label",
    "Creator": "username",       # rename here
    "Project": "project",
    "Difficulty": "difficulty",
    "Level Code": "code"         # rename here
}

# Extra fields to add (lowercase keys)
extra_fields = {
    "date": "",
    "post_id": "",
    "count": 0
}

def safe_get(row, key):
    return row.get(key, "")

with open(csv_file, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    output_data = []
    for row in reader:
        entry = {}
        # Add CSV fields with renaming
        for csv_field, json_key in field_mapping.items():
            entry[json_key] = safe_get(row, csv_field)

        # Add extra fields, check CSV columns case-insensitively
        for extra_key, default_val in extra_fields.items():
            found_val = ""
            for k in row:
                if k.lower() == extra_key:
                    found_val = row[k]
                    break
            entry[extra_key] = found_val if found_val != "" else default_val

        output_data.append(entry)

with open(json_file, "w", encoding="utf-8") as f:
    json.dump(output_data, f, indent=2)

print(f"Done. Converted {len(output_data)} entries.")
