"""
Residue — MongoDB index setup for cross-agent matching.

The Python CorrelationAgent shares the canonical `profiles` collection
with the rest of the app (src/lib/mongodb.ts -> getProfilesCollection).
This script ensures the helper indexes and Atlas Vector Search index
required by the cross-agent matching pipeline exist, without disturbing
the indexes already declared in `ensureMongoIndexes()`.

Atlas Vector Search indexes cannot reliably be created via pymongo on
all Atlas tiers, so this script prints the JSON definition for the
`optimalProfile.eqGains` vector index — paste it into the Atlas UI
under "Search → Create Search Index → JSON Editor" if the
auto-creation call fails.

Usage:
    python scripts/setup_mongo_indexes.py

Environment:
    MONGODB_URI    Connection string (required)
    MONGODB_DB     Database name (default: "residue")
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

DB_NAME = os.environ.get("MONGODB_DB", "residue")
COLLECTION_NAME = "profiles"
VECTOR_INDEX_NAME = "acoustic_profile_vector_index"


VECTOR_INDEX_DEFINITION = {
    "name": VECTOR_INDEX_NAME,
    "type": "vectorSearch",
    "definition": {
        "fields": [
            {
                "path": "optimalProfile.eqGains",
                "numDimensions": 7,
                "type": "vector",
                "similarity": "cosine",
            },
            {
                "path": "userId",
                "type": "filter",
            },
            {
                "path": "type",
                "type": "filter",
            },
        ]
    },
}


def main() -> int:
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        print("ERROR: MONGODB_URI is not set. Export it or add it to .env.")
        return 1

    try:
        from pymongo import ASCENDING, MongoClient
        from pymongo.errors import OperationFailure
    except ImportError:
        print("ERROR: pymongo is not installed. Run: pip install -r scripts/requirements.txt")
        return 1

    client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    db = client[DB_NAME]

    # Ensure the collection exists
    if COLLECTION_NAME not in db.list_collection_names():
        db.create_collection(COLLECTION_NAME)
        print(f"Created collection: {DB_NAME}.{COLLECTION_NAME}")
    else:
        print(f"Collection already exists: {DB_NAME}.{COLLECTION_NAME}")

    coll = db[COLLECTION_NAME]

    # Helper indexes for cross-agent matching. We do NOT add a unique
    # index on userId because the canonical `profiles` collection allows
    # multiple docs per user (e.g. a `type: 'bayesian'` variant written by
    # /api/profiles). The compound {userId: 1, type: 1} index from
    # ensureMongoIndexes() already covers prefix lookups by userId.
    coll.create_index([("agentAddress", ASCENDING)], name="agentAddress_idx")
    coll.create_index([("lastUpdated", ASCENDING)], name="lastUpdated_idx")
    print("Ensured indexes on agentAddress, lastUpdated")

    # Try to create the Atlas Vector Search index programmatically. This
    # only works on Atlas tiers that allow $createSearchIndex via the
    # driver; on other tiers it raises OperationFailure (CommandNotFound
    # or NotImplemented). We swallow the error and print the JSON below.
    vector_created = False
    try:
        existing = list(coll.list_search_indexes())
        names = {idx.get("name") for idx in existing}
        if VECTOR_INDEX_NAME in names:
            print(f"Atlas Vector Search index '{VECTOR_INDEX_NAME}' already exists.")
            vector_created = True
        else:
            coll.create_search_index(VECTOR_INDEX_DEFINITION)
            print(
                f"Created Atlas Vector Search index '{VECTOR_INDEX_NAME}' "
                "(may take a few minutes to become queryable)."
            )
            vector_created = True
    except OperationFailure as e:
        print(
            "Could not auto-create Atlas Vector Search index "
            f"({e.code_name or e.code}): {e}"
        )
    except Exception as e:  # pragma: no cover
        print(f"Could not auto-create Atlas Vector Search index: {e}")

    if not vector_created:
        print()
        print("=" * 72)
        print("Manual Atlas Vector Search index creation required.")
        print(
            "In Atlas → Database → Search → Create Search Index → JSON Editor,"
        )
        print(f"paste this definition (target collection: {COLLECTION_NAME}):")
        print("=" * 72)
        print(json.dumps(VECTOR_INDEX_DEFINITION, indent=2))
        print("=" * 72)

    return 0


if __name__ == "__main__":
    sys.exit(main())
