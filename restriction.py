# import json
# import pandas as pd

# def extract_room_names(obj, key="roomName"):
#     """
#     Recursively extract all values of a given key from nested JSON/dict/list.
#     """
#     room_names = []
#     if isinstance(obj, dict):
#         for k, v in obj.items():
#             if k == key:
#                 room_names.append(v)
#             else:
#                 room_names.extend(extract_room_names(v, key))
#     elif isinstance(obj, list):
#         for item in obj:
#             room_names.extend(extract_room_names(item, key))
#     return room_names


# def json_to_excel_unique(json_file, excel_file):
#     # Load JSON file
#     with open(json_file, "r", encoding="utf-8") as f:
#         data = json.load(f)

#     # Extract all room names
#     room_names = extract_room_names(data)

#     # Remove duplicates while preserving order
#     unique_room_names = list(dict.fromkeys(room_names))

#     # Convert to DataFrame
#     df = pd.DataFrame({"UniqueRoomNames": unique_room_names})

#     # Save to Excel
#     df.to_excel(excel_file, index=False)
#     print(f"✅ Found {len(unique_room_names)} unique room names saved to '{excel_file}'")


# # Example usage
# if __name__ == "__main__":
#     json_to_excel_unique("0.json", "unique_room_names.xlsx")










import pandas as pd
import json

def excel_to_json(excel_file, json_file):
    # Read Excel file
    df = pd.read_excel(excel_file)

    # Convert DataFrame to list of dictionaries
    data = df.to_dict(orient="records")

    # Save to JSON
    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

    print(f"✅ Converted '{excel_file}' → '{json_file}' with {len(data)} records.")


# Example usage
if __name__ == "__main__":
    excel_to_json("unique_room_names.xlsx", "room_data.json")
