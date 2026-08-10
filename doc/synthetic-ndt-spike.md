# Synthetic radiograph spike

DataLab-Web ships `public/demos/ndt.h5` as a deterministic **synthetic NDT
spike**. It is algorithm-development data, not an industrial radiograph, a
validated detection workflow, or evidence of compliance with an inspection
standard.

## Scope

The generator in `scripts/ndt_synthetic.py` composes:

- a smooth background representing thickness variation;
- seeded detector noise and low-amplitude texture;
- vertical and horizontal detector artifacts plus isolated bad pixels;
- compact and linear indications;
- varied indication sizes, orientations, and contrasts;
- one declared pair of overlapping compact indications.

The output is deterministic for a given image size and seed. The default
512 by 512 image is stored as unsigned 16-bit data.

## Ground truth

The workspace stores JSON ground truth in the image metadata key
`spike.ndt.synthetic_truth`. Each indication has a stable identifier and
records:

- `class`: `compact` or `linear`;
- `position`: center coordinates in pixels;
- `geometry`: ellipse radii and orientation;
- `contrast`: signed intensity difference used by the generator.

The payload also records the generator seed, image size, declared overlaps,
and artifact coordinates. `spike.ndt.disclaimer` marks the image as synthetic
algorithm-development data. The Python test suite opens the shipped HDF5 file
through the production workspace loader and verifies that these fields survive
the round trip.

## Permitted use

The spike may support tests of geometry, deterministic algorithm behavior,
detection rate, false-positive count, and measurement error against its own
synthetic truth. This repository does not currently include or validate an NDT
detection algorithm against those metrics.

The spike does **not** validate:

- radiographic realism or acquisition physics;
- performance on industrial data;
- an inspection protocol or image-quality threshold;
- automatic accept/reject decisions;
- compliance with an NDT standard.

Product development remains gated on an NDT subject-matter expert and an
exploitable annotated real-world corpus.

## Regeneration

Run the workspace generator in an environment containing Sigima and guidata:

```powershell
python scripts/gen_demo_workspaces.py
```

The script also regenerates the spectroscopy and photonics demo workspaces.
