window.BENCHMARK_DATA = {
  "lastUpdate": 1784366324446,
  "repoUrl": "https://github.com/DataLab-Platform/web",
  "entries": {
    "DataLab-Web perf (deterministic)": [
      {
        "commit": {
          "author": {
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut",
            "email": "1311787+PierreRaybaut@users.noreply.github.com"
          },
          "committer": {
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut",
            "email": "1311787+PierreRaybaut@users.noreply.github.com"
          },
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T09:46:40Z",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782468348834,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T11:46:40+02:00",
          "tree_id": "fe39f3917de53393e64010e8e61ce27dbeacc946",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782469465540,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": false,
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T11:46:40+02:00",
          "tree_id": "fe39f3917de53393e64010e8e61ce27dbeacc946",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782473105095,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "5cfdfc3f9e552c178fbe7f3474c97e48bd45e8bb",
          "message": "feat: add isDiskStorageSupported instance method to RuntimeApi and update benchmarks",
          "timestamp": "2026-06-26T17:47:02+02:00",
          "tree_id": "f7bd2772c258e9338b2e05e27a90df5f6b36094d",
          "url": "https://github.com/DataLab-Platform/web/commit/5cfdfc3f9e552c178fbe7f3474c97e48bd45e8bb"
        },
        "date": 1782489008255,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "6206853b532a1840d95602e4595e2327cc4ac281",
          "message": "feat: add theme option for demo GIF recording and update tests for theme handling",
          "timestamp": "2026-07-01T19:01:11+02:00",
          "tree_id": "5b0facc43bfa27aeaf7d6c1812cc3e313582e756",
          "url": "https://github.com/DataLab-Platform/web/commit/6206853b532a1840d95602e4595e2327cc4ac281"
        },
        "date": 1782925474341,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "c98dcc027f68a1aa19af311c20abd28dd0070e18",
          "message": "fix: keep command palette search results relevant for short queries\n\nFixes #8",
          "timestamp": "2026-07-08T19:05:30+02:00",
          "tree_id": "16a7a401d06607ee5bb0fcbad459cff8675f1958",
          "url": "https://github.com/DataLab-Platform/web/commit/c98dcc027f68a1aa19af311c20abd28dd0070e18"
        },
        "date": 1783530546346,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "493884fa0b61823b5d39cebcfb597dab4d883cc3",
          "message": "fix: clarify file destination when saving or exporting\n\nPrefer the native \"Save as…\" picker (Chromium) for every save/export\naction, with a non-modal toast confirming the destination when\nbrowsers fall back to a plain download; warn before \"Save to\ndirectory\" silently falls back the same way.\n\nFixes #7",
          "timestamp": "2026-07-08T19:12:34+02:00",
          "tree_id": "e544117fd9bf2044a00235f89740aac10e0ccf96",
          "url": "https://github.com/DataLab-Platform/web/commit/493884fa0b61823b5d39cebcfb597dab4d883cc3"
        },
        "date": 1783530965968,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "510626ea2db738605275d22921c7978b3f4b2586",
          "message": "fix: install tifffile so TIFF images can be saved and opened",
          "timestamp": "2026-07-08T19:37:40+02:00",
          "tree_id": "499fe11e59a91c283c06217b0763b5d9213ab76a",
          "url": "https://github.com/DataLab-Platform/web/commit/510626ea2db738605275d22921c7978b3f4b2586"
        },
        "date": 1783532451816,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "973e154661e0bff12bda41632816b906e31a335f",
          "message": "chore(perf): track ram Δheap as trend-only, not a determinist gate\n\nRAM-mode peak heap growth holds the full working set and is\nallocator-dependent, so single-sample swings trigger false regressions.\nKeep disk Δheap as the deterministic guard.",
          "timestamp": "2026-07-09T11:05:09+02:00",
          "tree_id": "7f6bafeabdab75dcb31f215e9e28de51a02fc773",
          "url": "https://github.com/DataLab-Platform/web/commit/973e154661e0bff12bda41632816b906e31a335f"
        },
        "date": 1783588715543,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "5be99ea07c1e42d18a29e68adf6a90cd88ce7331",
          "message": "fix: stringify HDF5 reference attributes in the h5 browser\n\nFixes #9",
          "timestamp": "2026-07-15T10:06:10+02:00",
          "tree_id": "776831a055c37ae9550fcd8cd8d417eed1aa6b08",
          "url": "https://github.com/DataLab-Platform/web/commit/5be99ea07c1e42d18a29e68adf6a90cd88ce7331"
        },
        "date": 1784102963650,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "7495830b900a531c4bc19f3c3e99424abacc7a5a",
          "message": "update changelog",
          "timestamp": "2026-07-15T10:46:28+02:00",
          "tree_id": "fabc1128ea257b4094ba4e9c78d341de24b3684c",
          "url": "https://github.com/DataLab-Platform/web/commit/7495830b900a531c4bc19f3c3e99424abacc7a5a"
        },
        "date": 1784105387052,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.7,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "71eed641280b97d8886af60bf7590b0905256a00",
          "message": "feat(image): default to outlier-eliminated contrast (match desktop)\n\nImages now open with the central 98% of the histogram mass, mirroring\ndesktop's ima_eliminate_outliers (2%) instead of raw min/max, which\ncould wash out contrast on a few extreme pixels. Auto button resets to\nthe same range.",
          "timestamp": "2026-07-15T14:21:30+02:00",
          "tree_id": "455cd23d190cd617305224e2a4fe68e6b1d18bf4",
          "url": "https://github.com/DataLab-Platform/web/commit/71eed641280b97d8886af60bf7590b0905256a00"
        },
        "date": 1784118290218,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "fa72c58e644fe752637510846b30d5c16438ebd8",
          "message": "feat(demo): enhance GIF generation with lossless frame capture and quality options",
          "timestamp": "2026-07-18T11:09:40+02:00",
          "tree_id": "4cde73033333448da8b3020e85c2f2f254910df6",
          "url": "https://github.com/DataLab-Platform/web/commit/fa72c58e644fe752637510846b30d5c16438ebd8"
        },
        "date": 1784365982865,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "31cf3779e4d4bcc4956b00aedae4d7f6262b09f9",
          "message": "v0.6.3",
          "timestamp": "2026-07-18T11:15:05+02:00",
          "tree_id": "4aab9fb2756ea450d019b9dc688335cf5814632b",
          "url": "https://github.com/DataLab-Platform/web/commit/31cf3779e4d4bcc4956b00aedae4d7f6262b09f9"
        },
        "date": 1784366308277,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "31cf3779e4d4bcc4956b00aedae4d7f6262b09f9",
          "message": "v0.6.3",
          "timestamp": "2026-07-18T11:15:05+02:00",
          "tree_id": "4aab9fb2756ea450d019b9dc688335cf5814632b",
          "url": "https://github.com/DataLab-Platform/web/commit/31cf3779e4d4bcc4956b00aedae4d7f6262b09f9"
        },
        "date": 1784366323594,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 43,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 51.6,
            "unit": "MiB"
          }
        ]
      }
    ]
  }
}