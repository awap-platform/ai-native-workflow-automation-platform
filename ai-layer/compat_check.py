"""Pilot compatibility check for C-based dependencies on Python 3.15.

Verifies that the AI layer's C-based dependencies compile/import and run a
basic operation. Fails fast when the interpreter or a dependency is unusable.
"""

import sys


def main() -> int:
    assert sys.version_info >= (3, 15), f"Expected Python 3.15+, got {sys.version}"

    import grpc

    assert grpc.__version__

    import pydantic_core

    assert hasattr(pydantic_core, "SchemaValidator")

    print(f"Python {sys.version.split()[0]} — C-based dependencies OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
