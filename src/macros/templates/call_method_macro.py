# Demonstrate proxy.call_method (escape hatch for whitelisted callbacks)

# List currently visible signals/images via the bridge.
sigs = await proxy.list_signals()
imgs = await proxy.list_images()
print(f"Signals: {len(sigs)} | Images: {len(imgs)}")

# Switch panels through the proxy.
await proxy.set_current_panel("signal")
print(f"Current panel: {await proxy.get_current_panel()}")
