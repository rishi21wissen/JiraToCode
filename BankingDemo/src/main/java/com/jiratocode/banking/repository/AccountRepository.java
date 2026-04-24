package com.jiratocode.banking.repository;

import com.jiratocode.banking.model.Account;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AccountRepository extends JpaRepository<Account, Long> {
    
    List<Account> findByUserId(Long userId);
    
}
