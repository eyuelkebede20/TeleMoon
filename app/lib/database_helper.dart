import 'dart:io';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:path_provider/path_provider.dart';

class DatabaseHelper {
  static const _databaseName = "TeleMoonLocal.db";
  static const _databaseVersion = 1;

  static const tableChannels = 'channels';
  static const columnId = '_id';
  static const columnName = 'name';
  static const columnLink = 'link';

  // Singleton class
  DatabaseHelper._privateConstructor();
  static final DatabaseHelper instance = DatabaseHelper._privateConstructor();

  static Database? _database;

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  void setDatabaseForTesting(Database? db) {
    _database = db;
  }

  Future<Database> _initDatabase() async {
    String dbPath;
    try {
      final documentsDirectory = await getApplicationDocumentsDirectory();
      dbPath = join(documentsDirectory.path, _databaseName);
    } catch (_) {
      dbPath = join(Directory.current.path, _databaseName);
    }

    return await openDatabase(
      dbPath,
      version: _databaseVersion,
      onConfigure: (db) async {
        await db.execute('PRAGMA journal_mode = WAL;');
        await db.execute('PRAGMA busy_timeout = 5000;');
      },
      onCreate: _onCreate,
    );
  }

  Future<void> _onCreate(Database db, int version) async {
    await db.execute('''
          CREATE TABLE $tableChannels (
            $columnId INTEGER PRIMARY KEY AUTOINCREMENT,
            $columnName TEXT NOT NULL,
            $columnLink TEXT NOT NULL
          )
          ''');
  }

  Future<int> insertChannel(Map<String, dynamic> row) async {
    Database db = await instance.database;
    return await db.insert(tableChannels, row);
  }

  Future<List<Map<String, dynamic>>> queryAllChannels() async {
    Database db = await instance.database;
    return await db.query(tableChannels);
  }

  Future<int> deleteChannel(int id) async {
    Database db = await instance.database;
    return await db.delete(tableChannels, where: '$columnId = ?', whereArgs: [id]);
  }
}
