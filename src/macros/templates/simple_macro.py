# Simple macro example

import numpy as np

# `proxy` is pre-injected (DataLab-Web equivalent of RemoteProxy).
# All proxy methods are async — use `await`.

x = np.linspace(-10, 10, 500)
y = np.sin(x) / (x + 1e-9)
oid = await proxy.add_signal("sinc", x, y)
print(f"Created signal {oid}")

# Switch to the Signals panel so the new signal becomes visible.
await proxy.set_current_panel("signal")

print("All done!")
