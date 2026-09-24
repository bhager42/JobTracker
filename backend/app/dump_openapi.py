"""Print the OpenAPI schema as JSON. Used by the frontend's `pnpm gen:api`."""

import json
import logging
import sys


def main() -> None:
    # Keep the output clean: importing the app logs that there is no frontend build.
    logging.disable(logging.WARNING)
    from app.main import create_app

    json.dump(create_app().openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
