import unittest
import os
import json
import sqlite3
import database
import downloader
import app as flask_app

class TuneStreamTestCase(unittest.TestCase):
    def setUp(self):
        flask_app.app.config["TESTING"] = True
        self.client = flask_app.app.test_client()
        database.init_db()

    def test_url_normalization(self):
        urls = [
            ("https://www.youtube.com/playlist?list=PL1234567890", "PL1234567890"),
            ("https://music.youtube.com/playlist?list=PLabcdef", "PLabcdef"),
            ("https://www.youtube.com/watch?v=xyz&list=PL9999", "PL9999"),
            ("PLmycustomplaylist", "PLmycustomplaylist"),
        ]
        for url, expected_id in urls:
            pid, norm_url = downloader.normalize_playlist_url(url)
            self.assertEqual(pid, expected_id)
            self.assertTrue(norm_url.startswith("https://www.youtube.com/playlist?list="))

    def test_duration_formatter(self):
        self.assertEqual(downloader.format_duration(0), "0:00")
        self.assertEqual(downloader.format_duration(45), "0:45")
        self.assertEqual(downloader.format_duration(125), "2:05")
        self.assertEqual(downloader.format_duration(3665), "1:01:05")

    def test_database_crud(self):
        p = database.add_playlist("test_pl_1", "Test Playlist", "https://www.youtube.com/playlist?list=test_pl_1")
        self.assertIsNotNone(p)
        self.assertEqual(p["title"], "Test Playlist")

        t1 = database.add_track("test_pl_1", "vid_1", "Song 1", "Artist 1", 180, "3:00", "/thumb/1.jpg", 1)
        t2 = database.add_track("test_pl_1", "vid_2", "Song 2", "Artist 2", 210, "3:30", "/thumb/2.jpg", 2)
        self.assertIsNotNone(t1)
        self.assertIsNotNone(t2)

        tracks = database.get_playlist_tracks("test_pl_1")
        self.assertEqual(len(tracks), 2)
        self.assertEqual(tracks[0]["title"], "Song 1")
        self.assertEqual(tracks[0]["status"], "pending")

        database.update_track_status(t1, "completed", file_path="/fake/path.mp3")
        updated_t1 = database.get_track(t1)
        self.assertEqual(updated_t1["status"], "completed")
        self.assertEqual(updated_t1["file_path"], "/fake/path.mp3")

        playlists = database.get_playlists()
        found = [pl for pl in playlists if pl["id"] == "test_pl_1"]
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["total_tracks"], 2)
        self.assertEqual(found[0]["completed_tracks"], 1)

        database.delete_playlist("test_pl_1")
        self.assertIsNone(database.get_playlist("test_pl_1"))

    def test_api_routes(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"TuneStream", res.data)

        res = self.client.get("/api/playlists")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("playlists", data)

        res = self.client.get("/api/downloads/status")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("active", data)
        self.assertIn("queue_count", data)

        res = self.client.get("/manifest.json")
        self.assertEqual(res.status_code, 200)
        res.close()
        res = self.client.get("/sw.js")
        self.assertEqual(res.status_code, 200)
        res.close()

        res = self.client.get("/thumbnail/nonexistent.jpg")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.content_type.startswith("image/svg+xml"))
        res.close()

if __name__ == "__main__":
    unittest.main()
