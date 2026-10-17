# Provenance and capsules

DataLab-Web records how each result was obtained: the processing or analysis applied, its parameters, the objects it used with their exact content, and the software versions. This record is saved with the HDF5 workspace. DataLab-Web and DataLab Desktop both read it back, and both exchange it as a **capsule**.

This page follows the usual path, from processing to exchange. Nothing in it requires a server of your own, an account or a command line. The browser downloads the computation engine when DataLab-Web starts (there is no offline mode); your data and computations stay in the browser.

## 1. Process, save, close and reopen

Process signals and images as usual: each processing is recorded at the same time. If the runtime cannot record provenance, DataLab-Web says _Provenance is not available in this session: processing works as usual._

_File > Save to HDF5 file…_ saves the workspace with its provenance. _File > Open HDF5 files…_ replaces the current workspace by a saved one and reads its provenance back, whether it was saved by DataLab-Web or by DataLab Desktop.

## 2. See where a result comes from

Select an object and open the **Provenance** tab of the side panel:

- **Production** shows the recorded step that produced the current content: the operation, its parameters, its inputs and results with their status. **Recorded analyses** lists the analyses run on the object.
- **▸ Show recorded step**, under an input, shows how that input was itself produced, as it was at the time, even if the input object was modified since.
- **Go to object** selects the object that holds an input or a result today.
- **Details** shows the context of the step (options, X alignment, metadata read) and the software versions.
- **Records of an old workspace** shows what older versions stored in the object metadata. These records are shown as stored and are never replayed.

Consulting reads the record only. It never computes, never loads data and never changes the workspace.

## 3. Consult, check, verify: three different things

| Action                                       | What it does                                                                                            | Computes?                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Consult (the **Provenance** tab)             | Reads the record                                                                                        | No                                           |
| **Check data**                               | Compares the object, the inputs and results of its production with their recorded states (fingerprints) | No                                           |
| **Verify computation**, **Verify this step** | Recomputes the step separately and compares every result with the recorded one                          | Yes, on copies; the workspace is not changed |

A verification gives one of four verdicts:

- _Exact_: same values.
- _Within tolerance_: values within the tolerance declared and justified for that operation (e.g. Fourier transforms, fits).
- _Different_.
- _Not verified_, with its reason, e.g. an original input missing or an operation that cannot be replayed.

With the disk storage mode, the data of an object may not be loaded. **Check data** then says _The data of the object are not loaded: they cannot be checked_: it does not load them silently.

## 4. An earlier state whose data are gone

The record describes every state used by a computation (its fingerprint, how it was produced). The data themselves are those of the workspace: an earlier state is kept only while an object still holds it. When an input was modified or deleted after the computation, its description is still shown (_This input has changed since the computation_, _Original input missing_), but the step cannot be recomputed from it: its verification is _Not verified_, with the reason.

To keep a result verifiable, keep the objects it was computed from before saving.

## 5. Exchange a capsule with the other edition

_File > Workspace capsule…_ opens the capsule dialog. DataLab Desktop offers the same dialog, and a capsule exported by either edition opens in the other one.

- **Export**: name, description, attachments (light files such as a protocol, at most 8 of 16 MiB each, never opened), and **Revision of…** when the workspace was opened from a capsule. **Reference the workspace instead of including it** stores only the address, size and SHA-256 of the workspace. **Export capsule…** downloads the capsule.
- **Inspect**: **Choose a capsule…** checks a capsule without opening it. It shows the summary, the **Attachments** (saved only with **Save…**), the **Integrity** computed from the files (nothing is recomputed), and the **Supplied documents** (verification reports and reviews, added with **Add a verification report…** and **Add a review…**). **Write a review** creates a separate review file. **Open as workspace** replaces the current workspace by the workspace of the capsule.
- **Local replay** lists the recorded activities of the open workspace. **Replay** recomputes one and gives its verdict; **Save report…** saves the verification report.
- **Revisions** lists the capsules exported, inspected or retrieved in this browser, and compares two of them (**Compare**).
- **Registry** (optional): **List revisions**, **Retrieve** and **Publish to the registry**, with everything returned checked.

The integrity of a capsule, the supplied documents and the local replay are always shown apart. A verdict written in a supplied report is what its author claims; a local replay is what DataLab-Web computed.

In the browser, a capsule (and a referenced workspace) is limited to 256 MiB, and its manifest to 16 MiB; an export that the browser could not open again is refused. These limits are accepted sizes, not a guarantee: on a laptop of 2026 (32 GiB of RAM, Chromium), capsules of about 130 MiB were exported, inspected and opened in 1.8 to 3.5 s each, and a 233 MiB capsule in up to 5.7 s, the page then using about 1.5 GiB of memory for the computation engine. Consulting a result stays immediate whatever the size; checking its data and verifying it take longer with larger arrays.

## 6. Adding a workspace instead of replacing it

In the interface, _File > Open HDF5 files…_ always replaces the current workspace and keeps the provenance of the file. _File > Browse HDF5 file…_ imports datasets as new objects: they have no recorded production (_Observed state, without recorded production_).

Scripts can add a workspace to the current one. The data are then added, but their earlier provenance is not imported, and DataLab-Web returns that notice. An added object never inherits the provenance of another object. To keep the provenance of a file, open it replacing the current workspace. DataLab Desktop asks before appending.

## What provenance does not do

- **It does not keep every earlier array.** Earlier states are described by their fingerprints. Their data remain available only while an object holds them.
- **It does not clean up the workspace.** Trials and intermediate objects stay in the workspace, and their recorded steps stay in the record, until you remove them. Deleting an object never rewrites the record.
- **It does not make everything verifiable.** Changes made outside recorded processing (data edited or imported, operations unknown to the computation library, such as some plugins) appear as observed states or opaque operations: they are described, never replayed.
- **It is not a proof of scientific validity.** _Exact_ or _Within tolerance_ says that the recorded computation is reproduced under the rule declared for that operation. It does not say that the processing was the right one.
- **It does not identify the author.** Fingerprints show that the content was not altered. They do not authenticate who produced it: capsules are not signed.

## Learn more

- The DataLab Desktop documentation describes the same features in its _Provenance of results_ and _Workspace capsules_ pages: <https://datalab-platform.com/>.
- [DataLab-Capsule](https://github.com/DataLab-Platform/DataLab-Capsule) describes the capsule format, the two-operator scenario between DataLab Desktop and DataLab-Web, and the comparison rules.
