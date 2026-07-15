window.BENCHMARK_DATA = {
  "lastUpdate": 1784118291955,
  "repoUrl": "https://github.com/DataLab-Platform/web",
  "entries": {
    "DataLab-Web perf (timings)": [
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
        "date": 1782468351351,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1778.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 80.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 21.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 162.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 156,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 290.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 252.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 173.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 188.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 333.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 335,
            "unit": "ms"
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
        "date": 1782469467691,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1894,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 51.3,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 44,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 233.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 166.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 350.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 259.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 184.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 157.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 337.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 320.8,
            "unit": "ms"
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
        "date": 1782473107931,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1395.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 90.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 15.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 168.5,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 149.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 246.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 172.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 185.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 159.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 246.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 234.1,
            "unit": "ms"
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
        "date": 1782489009982,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1580,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 74.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 22.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 159.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 144.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 319.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 236.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 184.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 188.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 298.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 307,
            "unit": "ms"
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
        "date": 1782925476484,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1729.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 90.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 15.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 183.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 151.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 258.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 272.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 180.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 179.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 306.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 290.9,
            "unit": "ms"
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
        "date": 1783530548001,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1563.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 47,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 26.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 230.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 213.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 309.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 289.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 251.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 250.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 382.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 380.2,
            "unit": "ms"
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
        "date": 1783530967697,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1744.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 74.8,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 14,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 198.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 189.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 262.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 225,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 248.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 226.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 357.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 312.2,
            "unit": "ms"
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
        "date": 1783532453835,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1886.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 81.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 43.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 147.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 159.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 317.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 236.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 194.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 173.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 305.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 344,
            "unit": "ms"
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
        "date": 1783588718005,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1771.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 93.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 196.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 185.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 272.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 196.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 224,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 206.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 339.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 309.9,
            "unit": "ms"
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
        "date": 1784102965272,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1771.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 80.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 18.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 179.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 137.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 270.5,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 175.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 180.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 174.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 314.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 320.2,
            "unit": "ms"
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
        "date": 1784105388796,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1486.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 81.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 23.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 193.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 158.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 254.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 235.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 166.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 190.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 303.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 367.4,
            "unit": "ms"
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
        "date": 1784118291699,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1957.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 187.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 21.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 201.5,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 163.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 306,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 204.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 153.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 186.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 279,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 329,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}