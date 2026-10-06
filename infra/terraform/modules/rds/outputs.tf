output "db_endpoint" {
  description = "Connection endpoint for the RDS instance"
  value       = aws_db_instance.mysql.endpoint
}

output "db_address" {
  description = "Hostname of the RDS instance"
  value       = aws_db_instance.mysql.address
}

output "db_port" {
  description = "Database port"
  value       = aws_db_instance.mysql.port
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.mysql.db_name
}
