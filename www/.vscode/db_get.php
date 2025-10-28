<?php
// MySQL 데이터베이스에 접속하는 코드
$servername = "localhost";
$username = "rhythmandjoy";
$password = "Rhythmjoy2019!";
$dbname = "rhythmandjoy";

// Create connection
$conn = new mysqli($servername, $username, $password, $dbname);

// Check connection
if ($conn->connect_error) {
  die("Connection failed: " . $conn->connect_error);
}

// Retrieve events within the given date range
$start = $_GET['start'];
$end = $_GET['end'];
$sql_get = "SELECT * FROM events WHERE start BETWEEN '$start' AND '$end'";
$result = $conn->query($sql_get);

// Prepare the array of events to be returned to FullCalendar
$events = [];
if ($result->num_rows > 0) {
  while($row = $result->fetch_assoc()) {
    $event = [
      "title" => $row["title"],
      "start" => date("Y-m-d\TH:i:s", strtotime($row["start"])),
      "end" => date("Y-m-d\TH:i:s", strtotime($row["end"])),     
      "color" => $row["color"],
      "id" => $row["id"]
    ];
    array_push($events, $event);
  }
}


$output = json_encode($events);

echo "<script>console.log(". $output .");</script>";

header('Content-Type: application/json');
echo $output;

$conn->close();
?>
