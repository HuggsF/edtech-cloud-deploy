resource "aws_db_subnet_group" "main" {
  name       = "edtech-rds-subnet-${var.environment}"
  subnet_ids = var.subnet_ids

  tags = {
    Name        = "edtech-rds-subnet-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_db_instance" "mysql" {
  identifier        = "edtech-db-${var.environment}"
  engine            = "mysql"
  engine_version     = "8.0"
  instance_class    = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp3"

  db_name  = var.database_name
  username = var.admin_username
  password = var.admin_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = var.security_group_ids

  multi_az               = var.multi_az
  publicly_accessible    = false
  skip_final_snapshot    = var.environment != "prod"
  deletion_protection    = var.environment == "prod"
  backup_retention_period = var.environment == "prod" ? 7 : 1

  tags = {
    Name        = "edtech-db-${var.environment}"
    Environment = var.environment
  }
}
